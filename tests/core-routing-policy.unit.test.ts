import { describe, expect, it } from "vitest";
import { resolveRoute, type RoutingRow } from "@/domain/core/routing-policy";

const row = (o: Partial<RoutingRow> & Pick<RoutingRow, "providerId">): RoutingRow => ({
  taskType: "analysis", tenantId: null, role: "primary", weight: 1, maxConcurrent: 5, ...o
});

describe("roteamento por tarefa e por cliente", () => {
  it("a linha do cliente vence a padrao", () => {
    const rows = [row({ providerId: "gemini" }), row({ providerId: "gpt", tenantId: "big" })];
    const r = resolveRoute({ rows, taskType: "analysis", tenantId: "big", providerState: {}, pick: 0 });
    expect(r.ok && r.value.providerId).toBe("gpt");
    const other = resolveRoute({ rows, taskType: "analysis", tenantId: "small", providerState: {}, pick: 0 });
    expect(other.ok && other.value.providerId).toBe("gemini");
  });
  it("divide por peso entre provedores do mesmo nivel", () => {
    const rows = [row({ providerId: "a", weight: 3 }), row({ providerId: "b", weight: 1 })];
    const at = (pick: number) => { const r = resolveRoute({ rows, taskType: "analysis", tenantId: "x", providerState: {}, pick }); return r.ok ? r.value.providerId : "erro"; };
    expect(at(0.0)).toBe("a"); expect(at(0.74)).toBe("a"); expect(at(0.76)).toBe("b");
  });
  it("respeita a lista de provedores permitidos do cliente", () => {
    const rows = [row({ providerId: "a" }), row({ providerId: "b" })];
    const r = resolveRoute({ rows, taskType: "analysis", tenantId: "x", allowedProviders: ["b"], providerState: {}, pick: 0 });
    expect(r.ok && r.value.providerId).toBe("b");
  });
  it("falha com aviso se nenhum permitido estiver disponivel", () => {
    const rows = [row({ providerId: "a" })];
    const r = resolveRoute({ rows, taskType: "analysis", tenantId: "x", allowedProviders: ["z"], providerState: {}, pick: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("routing.no_provider_available");
  });
  it("disjuntor aberto ou limite de simultaneas cheio tira o provedor e passa para a reserva", () => {
    const rows = [row({ providerId: "a", maxConcurrent: 2 }), row({ providerId: "r", role: "reserve" })];
    const full = resolveRoute({ rows, taskType: "analysis", tenantId: "x", providerState: { a: { circuitOpen: false, inFlight: 2 } }, pick: 0 });
    expect(full.ok && full.value).toMatchObject({ providerId: "r", role: "reserve" });
    const open = resolveRoute({ rows, taskType: "analysis", tenantId: "x", providerState: { a: { circuitOpen: true, inFlight: 0 } }, pick: 0 });
    expect(open.ok && open.value.providerId).toBe("r");
  });
  it("com principal disponivel, devolve as reservas para falha transitoria", () => {
    const rows = [row({ providerId: "a" }), row({ providerId: "r1", role: "reserve", weight: 2 }), row({ providerId: "r2", role: "reserve", weight: 1 })];
    const r = resolveRoute({ rows, taskType: "analysis", tenantId: "x", providerState: {}, pick: 0 });
    expect(r.ok && r.value.reserves).toEqual(["r1", "r2"]);
  });
  it("uma IA dedicada por tarefa: atendimento fixo, o resto em outra", () => {
    const rows = [row({ taskType: "attendance", providerId: "gpt" }), row({ providerId: "gemini" })];
    const a = resolveRoute({ rows, taskType: "attendance", tenantId: "x", providerState: {}, pick: 0 });
    const b = resolveRoute({ rows, taskType: "analysis", tenantId: "x", providerState: {}, pick: 0 });
    expect(a.ok && a.value.providerId).toBe("gpt");
    expect(b.ok && b.value.providerId).toBe("gemini");
  });
  it("rejeita configuracao invalida: peso zero e provedor duplicado", () => {
    expect(resolveRoute({ rows: [row({ providerId: "a", weight: 0 })], taskType: "analysis", tenantId: "x", providerState: {}, pick: 0 }).ok).toBe(false);
    expect(resolveRoute({ rows: [row({ providerId: "a" }), row({ providerId: "a" })], taskType: "analysis", tenantId: "x", providerState: {}, pick: 0 }).ok).toBe(false);
  });
  it("sem linha para a tarefa, falha", () => {
    expect(resolveRoute({ rows: [row({ providerId: "a" })], taskType: "decision", tenantId: "x", providerState: {}, pick: 0 }).ok).toBe(false);
  });
});
