import { describe, expect, it } from "vitest";
import { GRACE_MS, dueOccurrence, latestOccurrence, validateSchedule, type ReportSchedule } from "@/domain/reports/schedule";
import { csvCell, toCsv, type ReportRow } from "@/domain/reports/snapshot";
import { roleHasPermission } from "@/domain/security/permissions";

const SP = "America/Sao_Paulo";
const NY = "America/New_York";
const daily = (hour: number): ReportSchedule => ({ frequency: "daily", hour, weekday: 1, dayOfMonth: 1 });
const weekly = (hour: number, weekday: number): ReportSchedule => ({ frequency: "weekly", hour, weekday, dayOfMonth: 1 });
const monthly = (hour: number, dayOfMonth: number): ReportSchedule => ({ frequency: "monthly", hour, weekday: 1, dayOfMonth });

describe("agenda de relatórios", () => {
  it("diário: só depois da hora local; antes dela vale a ocorrência de ontem", () => {
    // 2026-10-16 10:59Z = 07:59 em São Paulo (UTC-3); 11:01Z = 08:01
    expect(latestOccurrence(daily(8), new Date("2026-10-16T10:59:00Z"), SP)).toMatchObject({ key: "2026-10-15" });
    const o = latestOccurrence(daily(8), new Date("2026-10-16T11:01:00Z"), SP)!;
    expect(o.key).toBe("2026-10-16");
    expect(o.at.toISOString()).toBe("2026-10-16T11:00:00.000Z");
  });
  it("não repete a mesma ocorrência e respeita a tolerância", () => {
    const now = new Date("2026-10-16T11:30:00Z");
    expect(dueOccurrence(daily(8), now, SP, null)?.key).toBe("2026-10-16");
    expect(dueOccurrence(daily(8), now, SP, "2026-10-16")).toBeNull();
    expect(dueOccurrence(daily(8), now, SP, "2026-10-15")?.key).toBe("2026-10-16");
    // sistema parado: passou da tolerância, espera a próxima em vez de mandar relatório velho
    const late = new Date(new Date("2026-10-16T11:00:00Z").getTime() + GRACE_MS + 60_000);
    expect(dueOccurrence(daily(8), late, SP, "2026-10-15")?.key ?? null).not.toBe("2026-10-16");
  });
  it("relatório novo não dispara a ocorrência anterior à sua criação", () => {
    const now = new Date("2026-10-16T12:00:00Z"); // 09h locais; o "de hoje às 8h" já passou, o de ontem às 10h também
    expect(dueOccurrence(daily(10), now, SP, null, new Date("2026-10-16T11:59:00Z"))).toBeNull();
    expect(dueOccurrence(daily(8), now, SP, null, new Date("2026-10-16T10:00:00Z"))?.key).toBe("2026-10-16");
  });
  it("semanal: ocorrência no dia da semana certo, no fuso da empresa", () => {
    // 2026-10-16 é sexta. Segunda (1) às 8h → 2026-10-12
    expect(latestOccurrence(weekly(8, 1), new Date("2026-10-16T15:00:00Z"), SP)?.key).toBe("2026-10-12");
    expect(latestOccurrence(weekly(8, 5), new Date("2026-10-16T15:00:00Z"), SP)?.key).toBe("2026-10-16");
  });
  it("mensal: dia do mês, e atravessa a virada do mês", () => {
    expect(latestOccurrence(monthly(9, 10), new Date("2026-10-16T15:00:00Z"), SP)?.key).toBe("2026-10-10");
    expect(latestOccurrence(monthly(9, 20), new Date("2026-10-16T15:00:00Z"), SP)?.key).toBe("2026-09-20");
    expect(latestOccurrence(monthly(9, 28), new Date("2026-01-05T15:00:00Z"), SP)?.key).toBe("2025-12-28");
  });
  it("fuso: o mesmo instante cai em dias diferentes conforme a empresa", () => {
    const now = new Date("2026-10-16T01:30:00Z"); // 22:30 do dia 15 em São Paulo; 21:30 do dia 15 em Nova York
    expect(latestOccurrence(daily(8), now, SP)?.key).toBe("2026-10-15");
    expect(latestOccurrence(daily(23), now, "Asia/Tokyo")?.key).toBe("2026-10-15"); // 10:30 do dia 16 no Japão; 23h do dia 15 já passou
  });
  it("horário de verão: 8h locais continuam 8h locais", () => {
    expect(latestOccurrence(daily(8), new Date("2026-03-07T14:00:00Z"), NY)?.at.toISOString()).toBe("2026-03-07T13:00:00.000Z"); // EST
    expect(latestOccurrence(daily(8), new Date("2026-03-09T14:00:00Z"), NY)?.at.toISOString()).toBe("2026-03-09T12:00:00.000Z"); // EDT
  });
  it("valida a agenda", () => {
    expect(validateSchedule({ frequency: "daily", hour: 8, weekday: 1, dayOfMonth: 1 })).not.toBeNull();
    expect(validateSchedule({ frequency: "daily", hour: 24, weekday: 1, dayOfMonth: 1 })).toBeNull();
    expect(validateSchedule({ frequency: "hourly", hour: 8, weekday: 1, dayOfMonth: 1 })).toBeNull();
    expect(validateSchedule({ frequency: "monthly", hour: 8, weekday: 1, dayOfMonth: 31 })).toBeNull();
    expect(validateSchedule({ frequency: "daily", hour: 8.5, weekday: 1, dayOfMonth: 1 })).toBeNull();
  });
});

describe("exportação CSV", () => {
  const row = (over: Partial<ReportRow>): ReportRow => ({ metricId: "m", name: "Nome", value: "10", unit: "count", currency: null, freshness: "fresh", quality: "verified", computedAt: new Date("2026-10-16T12:00:00Z"), ...over });
  it("texto que o Excel leria como fórmula ganha apóstrofo; aspas e vírgulas são protegidas", () => {
    expect(csvCell("=SOMA(A1)")).toBe("'=SOMA(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell(null)).toBe("");
  });
  it("valor ausente sai como indisponível, nunca zero; decimais ficam como texto exato", () => {
    const csv = toCsv([row({ value: null, freshness: "unavailable", quality: "missing", computedAt: null }), row({ metricId: "r", value: "1000.50", unit: "currency", currency: "BRL" })]);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("metric_id,metric,status,value,unit,currency,freshness,quality,computed_at");
    expect(lines[1]).toBe("m,Nome,unavailable,,count,,unavailable,missing,");
    expect(lines[2]).toBe("r,Nome,available,1000.50,currency,BRL,fresh,verified,2026-10-16T12:00:00.000Z");
    expect(csv.startsWith("﻿")).toBe(true);
  });
  it("permissões: analista lê relatórios e não altera; viewer não vê", () => {
    expect(roleHasPermission("admin", "report:write")).toBe(true);
    expect(roleHasPermission("analyst", "report:read")).toBe(true);
    expect(roleHasPermission("analyst", "report:write")).toBe(false);
    expect(roleHasPermission("viewer", "report:read")).toBe(false);
  });
});
