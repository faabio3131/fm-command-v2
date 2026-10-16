import { describe, expect, it } from "vitest";
import { addMoney, createMoney, formatMoney, sumByCurrency } from "@/domain/core/money";
import { parseTaskEnvelope } from "@/domain/core/task-envelope";
import { needsHuman, parseDecisionResponse } from "@/domain/core/decision-response";
import { parseUsageEvent } from "@/domain/core/usage-event";
import { isLocaleTag, isUtcIso } from "@/domain/core/result";

const task = {
  id: "t1", tenantId: "org1", taskType: "analysis", priority: 50, locale: "en-US",
  createdAt: "2026-10-15T20:00:00.000Z", deadlineAt: "2026-10-15T20:05:00.000Z",
  attempt: 0, maxAttempts: 3, idempotencyKey: "k1", payload: {}
};

describe("padroes web: dinheiro, datas, idioma", () => {
  it("dinheiro exige inteiro na menor unidade e moeda ISO 4217", () => {
    expect(createMoney(1999, "USD").ok).toBe(true);
    expect(createMoney(19.99, "USD").ok).toBe(false);
    expect(createMoney(100, "usd").ok).toBe(false);
    expect(createMoney(100, "XXZ").ok).toBe(false);
  });
  it("nao soma moedas diferentes e nao converte sozinho (ADR-012)", () => {
    const a = createMoney(100, "BRL"); const b = createMoney(100, "USD");
    if (!a.ok || !b.ok) throw new Error("setup");
    const r = addMoney(a.value, b.value);
    expect(r.ok).toBe(false);
    expect(sumByCurrency([a.value, b.value])).toEqual({ BRL: 100, USD: 100 });
  });
  it("formata pelo idioma da pessoa mantendo a moeda de origem", () => {
    const m = createMoney(123456, "BRL"); if (!m.ok) throw new Error("setup");
    expect(formatMoney(m.value, "pt-BR")).toContain("1.234,56");
    expect(formatMoney(m.value, "en-US")).toContain("1,234.56");
  });
  it("datas em UTC ISO 8601 e idioma BCP 47", () => {
    expect(isUtcIso("2026-10-15T20:00:00Z")).toBe(true);
    expect(isUtcIso("2026-10-15T17:00:00-03:00")).toBe(false);
    expect(isUtcIso("15/10/2026")).toBe(false);
    expect(isLocaleTag("pt-BR")).toBe(true);
    expect(isLocaleTag("portugues")).toBe(false);
  });
});

describe("envelope de tarefa", () => {
  it("aceita tarefa valida", () => expect(parseTaskEnvelope(task).ok).toBe(true));
  it("rejeita prazo fora de UTC, idioma invalido, tipo desconhecido e tentativas demais", () => {
    const r = parseTaskEnvelope({ ...task, deadlineAt: "2026-10-15T17:05:00-03:00", locale: "xx_yy!", taskType: "magia", attempt: 4 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining([
      "task.deadline_must_be_utc_iso", "task.locale_must_be_bcp47", "task.type_unknown", "task.attempt_exceeds_max"]));
  });
  it("exige empresa e chave de idempotencia", () => {
    const r = parseTaskEnvelope({ ...task, tenantId: "", idempotencyKey: " " });
    expect(r.ok).toBe(false);
  });
  it("prazo precisa ser depois da criacao", () => {
    expect(parseTaskEnvelope({ ...task, deadlineAt: task.createdAt }).ok).toBe(false);
  });
});

describe("decisao tipada", () => {
  it("valida sim/nao, escolha e nota", () => {
    expect(parseDecisionResponse({ kind: "yes_no", answer: true, probability: 0.9 }).ok).toBe(true);
    expect(parseDecisionResponse({ kind: "choice", options: ["a", "b"], chosen: "a", probability: 0.8 }).ok).toBe(true);
    expect(parseDecisionResponse({ kind: "score", min: 0, max: 10, value: 7, probability: 0.7 }).ok).toBe(true);
  });
  it("rejeita resposta fora do tipo", () => {
    expect(parseDecisionResponse({ kind: "choice", options: ["a", "b"], chosen: "c", probability: 0.8 }).ok).toBe(false);
    expect(parseDecisionResponse({ kind: "score", min: 0, max: 10, value: 11, probability: 0.7 }).ok).toBe(false);
    expect(parseDecisionResponse({ kind: "yes_no", answer: "sim", probability: 0.9 }).ok).toBe(false);
    expect(parseDecisionResponse({ kind: "yes_no", answer: true, probability: 1.2 }).ok).toBe(false);
    expect(parseDecisionResponse("texto livre").ok).toBe(false);
  });
  it("abaixo do limite vai para uma pessoa", () => {
    const d = parseDecisionResponse({ kind: "yes_no", answer: true, probability: 0.6 });
    if (!d.ok) throw new Error("setup");
    expect(needsHuman(d.value, 0.8)).toBe(true);
    expect(needsHuman(d.value, 0.5)).toBe(false);
  });
});

describe("evento de uso e custo", () => {
  const ev = { tenantId: "org1", taskId: "t1", providerId: "p1", model: "m", tokensIn: 10, tokensOut: 5,
    cost: { amountMinor: 3, currency: "USD" }, occurredAt: "2026-10-15T20:00:00Z" };
  it("aceita evento valido e exige custo com moeda", () => {
    expect(parseUsageEvent(ev).ok).toBe(true);
    expect(parseUsageEvent({ ...ev, cost: { amountMinor: 0.5, currency: "USD" } }).ok).toBe(false);
    expect(parseUsageEvent({ ...ev, cost: { amountMinor: 3 } }).ok).toBe(false);
  });
});
