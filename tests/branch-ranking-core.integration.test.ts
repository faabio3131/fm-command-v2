import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { buildCoreGateway } from "@/application/core/core-composition";
import type { CognitiveModel } from "@/domain/core/cognitive-model";
import type { CoreEvidence } from "@/domain/core/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { metricValues } from "@/infrastructure/db/platform-schema";
import { orgUnits, unitGrants } from "@/infrastructure/db/unit-schema";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

const A = "ranking-core-a";
const OUTRA = "ranking-core-b";
const METRIC = "billing.gross_billed";
const repo = new PostgresUnitRepository();
const store = new PostgresMetricStore();
const ctx = (tenantId: string, userId: string, role: TenantContext["role"]): TenantContext => ({ tenantId, userId, role, correlationId: `c-${userId}` });
let hq: string, sul: string, norte: string;
let captured: { facts: readonly Record<string, unknown>[]; evidence: readonly CoreEvidence[] } | null = null;

const save = (tenantId: string, unitId: string, value: string | null, currency = "BRL") => store.saveValue({
  tenantId, unitId, metricId: METRIC, metricVersion: 1, value, unit: "currency", currency, computedAt: new Date(), freshnessStatus: "fresh",
  qualityStatus: "verified", sourceAuthority: "fmcc_metric_engine", provenanceRefs: [`fact:${unitId}`],
});
// Modelo falso: só escolhe a capacidade de ranking e guarda o que recebeu. Prova que o texto vem de fatos do motor.
let planMetrics: readonly string[] = [METRIC];
const model: CognitiveModel = {
  async plan() { return { metricIds: planMetrics, capabilityIds: ["units.branch_ranking"] }; },
  async synthesize(input) { captured = { facts: input.facts, evidence: input.evidence }; return "ok"; },
};
const ask = (c: TenantContext, metrics: readonly string[] = [METRIC]) => { planMetrics = metrics; captured = null; return buildCoreGateway(model).ask(c, "Qual loja vendeu mais, a segunda, a terceira e a pior?"); };
const ranking = () => (captured?.facts.find((f) => f.capabilityId === "units.branch_ranking")?.rankings as Array<Record<string, any>>)[0];
const named = (positions: Array<{ position: number; branches: { name: string }[] }>) => positions.map((p) => [p.position, p.branches.map((b) => b.name)]);

async function cleanup() {
  await db.delete(metricValues).where(inArray(metricValues.tenantId, [A, OUTRA]));
  await db.delete(unitGrants).where(inArray(unitGrants.tenantId, [A, OUTRA]));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, [A, OUTRA]));
}
beforeAll(async () => {
  await cleanup();
  hq = (await repo.createUnit({ tenantId: A, kind: "company", parentId: null, name: "Matriz" })).id;
  sul = (await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "Sul" })).id;
  norte = (await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "Norte" })).id;
  const mk = async (parentId: string, name: string, value: string | null) => { const u = await repo.createUnit({ tenantId: A, kind: "branch", parentId, name }); await save(A, u.id, value); return u.id; };
  await mk(sul, "Curitiba", "182400.50"); await mk(sul, "Porto Alegre", "151900");
  await mk(norte, "Manaus", "97300"); await mk(norte, "Belém", "41200"); await mk(norte, "Macapá", null);
  await repo.grant({ tenantId: A, userId: "gerente-sul", unitId: sul, grantedBy: "dono" });
  const o = await repo.createUnit({ tenantId: OUTRA, kind: "company", parentId: null, name: "Outra" });
  const ob = await repo.createUnit({ tenantId: OUTRA, kind: "branch", parentId: o.id, name: "Filial da outra empresa" });
  await save(OUTRA, ob.id, "999999");
});
afterAll(cleanup);

describe("pergunta sobre ranking de filiais pelo Core (banco real)", () => {
  it("o dono recebe maior, 2ª, 3ª e menor vindos do motor; filial sem dado fica à parte, nunca zero", async () => {
    const r = await ask(ctx(A, "dono", "owner"));
    expect(r.factualStatus).toBe("grounded");
    const k = ranking();
    expect(k).toMatchObject({ metricId: METRIC, status: "available", higherIsWorse: false, reporting: 4, expected: 5, partial: true, withoutValue: ["Macapá"] });
    expect(named(k.positions)).toEqual([[1, ["Curitiba"]], [2, ["Porto Alegre"]], [3, ["Manaus"]]]);
    expect(k.positions[0].branches[0]).toMatchObject({ value: "182400.50", currency: "BRL" });
    expect(k.lowest.map((b: { name: string }) => b.name)).toEqual(["Belém"]);
    const ev = captured!.evidence.find((e) => e.ref === "branch-ranking");
    expect(ev).toMatchObject({ kind: "source", sourceAuthority: "fmcc_metric_engine", freshnessStatus: "fresh" });
    expect(ev?.provenanceRefs?.length).toBe(4);
  });
  it("quem só enxerga a região Sul recebe ranking só das filiais dela (escopo de unidades)", async () => {
    // Plano só com a capacidade: a leitura da métrica no nível da EMPRESA é negada a quem tem escopo parcial (ADR-019, inalterado).
    await ask(ctx(A, "gerente-sul", "analyst"), []);
    const k = ranking();
    expect(named(k.positions)).toEqual([[1, ["Curitiba"]], [2, ["Porto Alegre"]]]);
    expect(k.lowest.map((b: { name: string }) => b.name)).toEqual(["Porto Alegre"]);
    expect(JSON.stringify(captured)).not.toMatch(/Manaus|Belém|Macapá/);
  });
  it("nunca mistura outra empresa e, sem filiais com valor, responde indisponível em vez de inventar", async () => {
    await ask(ctx(A, "dono", "owner"));
    expect(JSON.stringify(captured)).not.toMatch(/outra empresa|999999/);
    const vazio = await buildCoreGateway(model).ask(ctx("ranking-core-vazio", "dono", "owner"), "Qual loja vendeu mais?");
    expect(vazio.factualStatus).toBe("unavailable");
  });
  it("moedas diferentes entre filiais suspendem o ranking: indisponível, sem ordenar BRL com USD", async () => {
    const u = await repo.createUnit({ tenantId: A, kind: "branch", parentId: norte, name: "Miami" });
    await save(A, u.id, "500000", "USD");
    const r = await ask(ctx(A, "dono", "owner"));
    expect(r.factualStatus).toBe("unavailable");
    // Nenhum fato de ranking chega à IA: ela não tem como ordenar BRL com USD.
    expect(captured).toBeNull();
  });
});
