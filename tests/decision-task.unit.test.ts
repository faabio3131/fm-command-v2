import { describe, expect, it } from "vitest";
import { buildDecisionPrompt, interpretDecision, parseDecisionRequest } from "@/domain/core/decision-task";
import { createDecisionHandler } from "@/application/core/decision-handler";
import { PermanentTaskError } from "@/application/core/work-worker";
import { ProviderBadRequestError } from "@/domain/core/ai-provider";
import type { ProviderRouter } from "@/application/core/provider-router";
import type { WorkItem } from "@/domain/core/work-queue";
import { evaluate, type EvalCase, type EvalModel } from "@/application/core/decision-eval";

const opts = [{ id: "a", label: "Opção A" }, { id: "b", label: "Opção B" }];
const choice = { kind: "choice", question: "Qual?", options: opts };

describe("pedido de decisao", () => {
  it("aceita escolha, sim/nao e nota validos", () => {
    expect(parseDecisionRequest(choice).ok).toBe(true);
    expect(parseDecisionRequest({ kind: "yes_no", question: "Ok?" }).ok).toBe(true);
    expect(parseDecisionRequest({ kind: "score", question: "Nota?", min: 0, max: 10 }).ok).toBe(true);
  });
  it("recusa pedido malformado", () => {
    const bad: unknown[] = [null, { kind: "choice", question: "", options: opts }, { kind: "choice", question: "q", options: [opts[0]] },
      { kind: "choice", question: "q", options: [opts[0], opts[0]] }, { kind: "choice", question: "q", options: [{ id: "", label: "x" }, opts[1]] },
      { kind: "score", question: "q", min: 5, max: 5 }, { kind: "score", question: "q", min: 0, max: Infinity }, { kind: "x", question: "q" },
      { kind: "choice", question: "q".repeat(2001), options: opts }];
    for (const b of bad) expect(parseDecisionRequest(b).ok).toBe(false);
  });
  it("o prompt carrega so pergunta e opcoes (enxuto)", () => {
    const p = buildDecisionPrompt(choice as never);
    expect(p.maxTokens).toBeLessThanOrEqual(100);
    expect(p.user).toContain("Opção A");
  });
  it("opcoes e intervalo vem do pedido, nao do eco do modelo", () => {
    const req = parseDecisionRequest(choice); if (!req.ok) throw new Error();
    expect(interpretDecision(req.value, 'texto {"chosen":"a","probability":0.9} fim')).toMatchObject({ ok: true, value: { kind: "choice", chosen: "a", probability: 0.9 } });
    for (const t of ["sem json", '{"chosen":"z","probability":0.9}', '{"chosen":"a","probability":1.5}', '{"chosen":"a"}', '{"chosen":"a","options":["z","y"],"probability":"0.9"}'])
      expect(interpretDecision(req.value, t).ok).toBe(false);
    const sc = parseDecisionRequest({ kind: "score", question: "n", min: 0, max: 10 }); if (!sc.ok) throw new Error();
    expect(interpretDecision(sc.value, '{"value":11,"probability":0.9}').ok).toBe(false);
    expect(interpretDecision(sc.value, '{"value":7,"probability":0.9}').ok).toBe(true);
  });
});

const item = (payload: Record<string, unknown>): WorkItem => ({ id: "w1", tenantId: "t", unitId: null, taskType: "decision", priority: 50, locale: "pt-BR", payload, idempotencyKey: "k", attempt: 1, maxAttempts: 2, deadlineAt: new Date(Date.now() + 60_000), leaseToken: "l" });
const routerReturning = (text: string, seen: { taskType?: string } = {}) => ({ execute: async (i: { taskType: string }) => { seen.taskType = i.taskType; return { text, providerId: "p", role: "primary", model: "m", tokensIn: 100, tokensOut: 10, costMicroMinor: 5, currency: "USD", attempted: ["p"] }; } }) as unknown as ProviderRouter;

describe("executor de decisao", () => {
  const sig = new AbortController().signal;
  it("usa a rota 'decision', devolve a decisao e marca baixa confianca", async () => {
    const seen: { taskType?: string } = {};
    const hi = await createDecisionHandler(routerReturning('{"chosen":"b","probability":0.95}', seen))(item(choice), sig);
    expect(seen.taskType).toBe("decision");
    expect(hi).toMatchObject({ needsHuman: false, decision: { chosen: "b" }, costMicroMinor: 5 });
    const lo = await createDecisionHandler(routerReturning('{"chosen":"b","probability":0.5}'))(item(choice), sig);
    expect(lo).toMatchObject({ needsHuman: true });
    const custom = await createDecisionHandler(routerReturning('{"chosen":"b","probability":0.5}'), { threshold: 0.4 })(item(choice), sig);
    expect(custom).toMatchObject({ needsHuman: false });
  });
  it("pedido invalido e permanente; saida invalida do modelo e repetivel; pedido ruim ao provedor e permanente", async () => {
    await expect(createDecisionHandler(routerReturning("{}"))(item({ kind: "choice" }), sig)).rejects.toBeInstanceOf(PermanentTaskError);
    const e = await createDecisionHandler(routerReturning("lixo"))(item(choice), sig).catch((x) => x);
    expect(e).toBeInstanceOf(Error); expect(e).not.toBeInstanceOf(PermanentTaskError);
    const bad = { execute: async () => { throw new ProviderBadRequestError("ai.bad"); } } as unknown as ProviderRouter;
    await expect(createDecisionHandler(bad)(item(choice), sig)).rejects.toBeInstanceOf(PermanentTaskError);
  });
});

describe("avaliacao contra o planejador", () => {
  const cases: EvalCase[] = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, locale: "pt-BR", difficulty: i < 6 ? "easy" : "hard", question: "q", options: opts, gold: "a" }));
  const pricing = { currency: "USD", inputMinorPerMillion: 1_000_000, outputMinorPerMillion: 0 };
  const model = (name: string, f: (i: number) => { chosen: string; probability: number }, tokensIn: number, latencyMs: number): EvalModel => {
    let n = 0; return { name, pricing, call: async () => ({ ...f(n++), tokensIn, tokensOut: 0, latencyMs }) };
  };
  it("mede acerto, concordancia, escalada, erro confiante e a cascata", async () => {
    const planner = model("grande", () => ({ chosen: "a", probability: 0.99 }), 1000, 1000);
    // rapido: acerta 0-6; erra 7 com baixa confianca, erra 8 e 9 com alta confianca; 
    const fast = model("rapido", (i) => (i <= 6 ? { chosen: "a", probability: 0.95 } : i === 7 ? { chosen: "b", probability: 0.4 } : { chosen: "b", probability: 0.9 }), 100, 200);
    const r = await evaluate(cases, planner, fast, 0.8);
    expect(r.planner.accuracy).toBe(1);
    expect(r.fast.accuracy).toBeCloseTo(0.7);
    expect(r.agreement).toBeCloseTo(0.7);
    expect(r.escalationRate).toBeCloseTo(0.1);
    expect(r.confidentWrong).toBe(2);
    expect(r.acceptedAccuracy).toBeCloseTo(7 / 9);
    expect(r.cascade.accuracy).toBeCloseTo(0.8); // so o caso 7 foi corrigido pela escalada
    expect(r.fast.costMicroMinor).toBe(10 * 100 * 1_000_000);
    expect(r.cascade.costMicroMinor).toBe(10 * 100 * 1_000_000 + 1000 * 1_000_000);
    expect(r.cascade.avgLatencyMs).toBeCloseTo(200 + 100);
    await expect(evaluate([], planner, fast, 0.8)).rejects.toThrow("eval.no_cases");
  });
});
