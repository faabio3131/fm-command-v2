import { describe, expect, it } from "vitest";
import { parsePeriodKind, resolvePeriod, PERIOD_KINDS } from "@/domain/metrics/period";

const SP = "America/Sao_Paulo";
const iso = (d: Date) => d.toISOString();

describe("períodos escolhíveis", () => {
  const now = new Date("2026-10-16T15:00:00Z");
  it("mês corrente, anterior, trimestre e ano no calendário da empresa", () => {
    expect(resolvePeriod("current", now, SP)).toMatchObject({ periodStart: new Date("2026-10-01T03:00:00Z"), periodEnd: now });
    expect(resolvePeriod("previous", now, SP)).toMatchObject({ periodStart: new Date("2026-09-01T03:00:00Z"), periodEnd: new Date("2026-10-01T03:00:00Z") });
    expect(resolvePeriod("quarter", now, SP).periodStart).toEqual(new Date("2026-10-01T03:00:00Z"));
    expect(resolvePeriod("year", now, SP).periodStart).toEqual(new Date("2026-01-01T03:00:00Z"));
  });
  it("trimestre começa em janeiro, abril, julho e outubro", () => {
    const start = (m: number) => iso(resolvePeriod("quarter", new Date(Date.UTC(2026, m - 1, 15, 15)), "UTC").periodStart);
    expect([1, 2, 3, 4, 6, 7, 9, 10, 12].map(start)).toEqual([
      "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z",
    ]);
  });
  it("em janeiro o mês anterior é dezembro do ano passado", () => {
    const p = resolvePeriod("previous", new Date("2027-01-10T12:00:00Z"), "UTC");
    expect([iso(p.periodStart), iso(p.periodEnd)]).toEqual(["2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
  });
  it("o fuso decide o mês: 1º de outubro 01h em UTC ainda é setembro em São Paulo", () => {
    const edge = new Date("2026-10-01T01:00:00Z");
    expect(iso(resolvePeriod("current", edge, "UTC").periodStart)).toBe("2026-10-01T00:00:00.000Z");
    expect(iso(resolvePeriod("current", edge, SP).periodStart)).toBe("2026-09-01T03:00:00.000Z");
  });
  it("valor desconhecido vira o padrão, nunca outro período nem erro", () => {
    expect(parsePeriodKind("year")).toBe("year");
    for (const bad of [undefined, null, "", "ano", "YEAR", 3, "current; drop table"]) expect(parsePeriodKind(bad)).toBe("current");
    expect(PERIOD_KINDS).toEqual(["current", "previous", "quarter", "year"]);
  });
});
