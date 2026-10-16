import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createMetricService } from "@/application/metrics/metric-composition";
import { createUnitScopeResolver } from "@/application/organization/unit-scope";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { buildActivityFeedService } from "@/application/activity/activity-feed-composition";
import { UnitAccessDeniedError } from "@/domain/organization/unit-hierarchy";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { canonicalFacts, metricValues, productDefinitions, sourceDefinitions } from "@/infrastructure/db/platform-schema";
import { orgUnits, unitGrants } from "@/infrastructure/db/unit-schema";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresCanonicalFactRepository, PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

const A = "escopo-leitura-a"; // empresa com filiais
const V1 = "escopo-leitura-v1"; // empresa sem arvore de unidades (comportamento da V1)
const repo = new PostgresUnitRepository();
const store = new PostgresMetricStore();
const metricId = METRIC_REGISTRY[0].metricId;
const ctx = (tenantId: string, userId: string, role: TenantContext["role"]): TenantContext => ({ tenantId, userId, role, correlationId: `c-${userId}` });
let hq: string, sul: string, cwb: string, poa: string, sp: string;

async function cleanup() {
  const t = [A, V1];
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, t));
  await db.delete(metricValues).where(inArray(metricValues.tenantId, t));
  await db.delete(canonicalFacts).where(inArray(canonicalFacts.tenantId, t));
  await db.delete(sourceDefinitions).where(inArray(sourceDefinitions.tenantId, t));
  await db.delete(productDefinitions).where(inArray(productDefinitions.tenantId, t));
  await db.delete(unitGrants).where(inArray(unitGrants.tenantId, t));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, t));
}
const saveValue = (tenantId: string, unitId: string | undefined, v: string) => store.saveValue({
  tenantId, unitId, metricId, metricVersion: 1, value: v, unit: "count", computedAt: new Date(), freshnessStatus: "fresh",
  qualityStatus: "verified", sourceAuthority: "teste", provenanceRefs: [],
});

beforeAll(async () => {
  await cleanup();
  hq = (await repo.createUnit({ tenantId: A, kind: "company", parentId: null, name: "Matriz" })).id;
  sul = (await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "Sul" })).id;
  cwb = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: sul, name: "Curitiba" })).id;
  poa = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: sul, name: "Porto Alegre" })).id;
  sp = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: hq, name: "São Paulo" })).id;
  await repo.grant({ tenantId: A, userId: "gerente-sul", unitId: sul, grantedBy: "owner" });
  await repo.grant({ tenantId: A, userId: "gerente-sp", unitId: sp, grantedBy: "owner" });
  await saveValue(A, cwb, "10"); await saveValue(A, poa, "20"); await saveValue(A, sp, "30"); await saveValue(A, undefined, "60"); await saveValue(V1, undefined, "7");

  // fatos: um em Curitiba, um em São Paulo, um no nivel da empresa; mais auditoria
  const products = new PostgresProductRepository();
  const product = await products.create(A, { slug: "kordena-esc", name: "Kordena" });
  const source = await new PostgresSourceRepository().create(A, { productId: product.id, name: "Cobranca", sourceType: "fixture", authoritativeDomain: "billing", syncMode: "pull" });
  const facts = new PostgresCanonicalFactRepository();
  for (const [id, minute] of [["f-cwb", 1], ["f-sp", 2], ["f-hq", 3]] as const)
    await facts.ingest({ tenantId: A, productId: product.id, sourceId: source.id, mappingVersion: "v1", correlationId: id, fact: { externalId: id, factType: "payment.settled", payload: { amount: "10.00", currency: "BRL" }, sourceTimestamp: new Date(`2026-10-04T10:0${minute}:00Z`) } });
  const rows = await db.select().from(canonicalFacts).where(eq(canonicalFacts.tenantId, A));
  const unitFor = (externalId: string) => (externalId === "f-cwb" ? cwb : externalId === "f-sp" ? sp : null);
  for (const r of rows) await db.update(canonicalFacts).set({ unitId: unitFor(r.externalId) }).where(eq(canonicalFacts.id, r.id));
  await db.insert(auditEvents).values({ tenantId: A, actorId: "owner", actorType: "user", action: "alert.raised", resourceType: "alert_occurrence", resourceId: "a1", result: "attention", correlationId: "aud-1", occurredAt: new Date("2026-10-04T10:05:00Z") });
});
afterAll(cleanup);

describe("metricas: toda rota passa pelo escopo", () => {
  const metrics = () => createMetricService();
  it("quem enxerga tudo (dono) le qualquer unidade e o nivel da empresa", async () => {
    const owner = ctx(A, "dono", "owner");
    expect((await metrics().query(owner, metricId, undefined, cwb))?.value).toBe("10");
    expect((await metrics().query(owner, metricId))?.value).toBe("60");
  });
  it("gerente do Sul le Curitiba (descendente) e nao le Sao Paulo nem o nivel da empresa", async () => {
    const g = ctx(A, "gerente-sul", "analyst");
    expect((await metrics().query(g, metricId, undefined, cwb))?.value).toBe("10");
    expect((await metrics().query(g, metricId, undefined, poa))?.value).toBe("20");
    await expect(metrics().query(g, metricId, undefined, sp)).rejects.toBeInstanceOf(UnitAccessDeniedError);
    await expect(metrics().query(g, metricId)).rejects.toBeInstanceOf(UnitAccessDeniedError);
    await expect(metrics().overview(g)).rejects.toBeInstanceOf(UnitAccessDeniedError);
    await expect(metrics().recompute(g, { metricId, unitId: sp })).rejects.toBeInstanceOf(UnitAccessDeniedError);
  });
  it("a negacao de unidade e uma negacao de permissao (as rotas ja respondem 403)", async () => {
    await expect(metrics().query(ctx(A, "gerente-sul", "analyst"), metricId, undefined, sp)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
  it("pessoa sem nenhuma concessao nao le nada, nem o nivel da empresa", async () => {
    const nobody = ctx(A, "sem-acesso", "analyst");
    await expect(metrics().query(nobody, metricId)).rejects.toBeInstanceOf(UnitAccessDeniedError);
    await expect(metrics().query(nobody, metricId, undefined, cwb)).rejects.toBeInstanceOf(UnitAccessDeniedError);
  });
  it("empresa sem arvore de unidades segue como na V1 (sem restricao)", async () => {
    expect((await metrics().query(ctx(V1, "qualquer", "analyst"), metricId))?.value).toBe("7");
  });
});

describe("feed de atividades respeita a unidade", () => {
  const feed = () => buildActivityFeedService();
  const amounts = async (c: TenantContext) => (await feed().page(c, { pageSize: 50 })).items.map((i) => `${i.eventType}`);
  it("dono ve fatos de todas as unidades, o fato da empresa e a auditoria", async () => {
    const items = await feed().page(ctx(A, "dono", "owner"), { pageSize: 50 });
    expect(items.items.filter((i) => i.provenanceRefs.some((r) => r.startsWith("canonical_fact"))).length).toBe(3);
    expect(items.items.some((i) => i.eventType === "alert.raised")).toBe(true);
  });
  it("gerente do Sul ve so o fato de Curitiba: sem Sao Paulo, sem nivel da empresa, sem auditoria", async () => {
    const page = await feed().page(ctx(A, "gerente-sul", "analyst"), { pageSize: 50 });
    const factItems = page.items.filter((i) => i.provenanceRefs.some((r) => r.startsWith("canonical_fact")));
    expect(factItems).toHaveLength(1);
    expect(page.items.some((i) => i.eventType === "alert.raised")).toBe(false);
    expect(page.items).toHaveLength(1);
  });
  it("gerente de Sao Paulo ve so o dele; pessoa sem concessao nao ve nada", async () => {
    expect((await feed().page(ctx(A, "gerente-sp", "analyst"), { pageSize: 50 })).items).toHaveLength(1);
    expect(await amounts(ctx(A, "sem-acesso", "analyst"))).toEqual([]);
  });
});

describe("alertas e telas: dado da empresa so para quem tem acesso a esse nivel", () => {
  it("gerente de filial recebe lista vazia de alertas; dono segue vendo (e empresa sem arvore nao muda)", async () => {
    const service = buildAlertService();
    expect(await service.overview(ctx(A, "gerente-sp", "analyst"))).toEqual({ rules: [], occurrences: [] });
    expect(await service.overview(ctx(A, "sem-acesso", "viewer"))).toEqual({ rules: [], occurrences: [] });
    await expect(service.overview(ctx(A, "dono", "owner"))).resolves.toBeDefined();
    await expect(service.overview(ctx(V1, "qualquer", "viewer"))).resolves.toBeDefined();
  });
  it("a porta de metricas informa quem pode ler dado da empresa", async () => {
    const m = createMetricService();
    expect(await m.canReadCompanyLevel(ctx(A, "gerente-sp", "analyst"))).toBe(false);
    expect(await m.canReadCompanyLevel(ctx(A, "dono", "owner"))).toBe(true);
    expect(await m.canReadCompanyLevel(ctx(V1, "qualquer", "viewer"))).toBe(true);
  });
});

describe("resolvedor de escopo", () => {
  it("consulta o banco uma vez por requisicao (contexto) e uma concessao revogada vale na requisicao seguinte", async () => {
    let calls = 0;
    const inner = new PostgresUnitRepository();
    const resolver = createUnitScopeResolver({ scopeFor: (c) => { calls++; return inner.scopeFor(c); } });
    const c1 = ctx(A, "gerente-sp", "analyst");
    await Promise.all([resolver(c1), resolver(c1), resolver(c1)]);
    expect(calls).toBe(1);
    expect((await resolver(c1)).kind).toBe("units");
    await db.delete(unitGrants).where(eq(unitGrants.userId, "gerente-sp"));
    expect(calls).toBe(1); // mesma requisicao: nao relê
    const next = await resolver(ctx(A, "gerente-sp", "analyst")); // requisicao nova
    expect(calls).toBe(2);
    expect(next.kind === "units" && next.unitIds.size).toBe(0);
  });
  it("falha do banco nao fica guardada", async () => {
    let n = 0;
    const resolver = createUnitScopeResolver({ scopeFor: async () => { if (n++ === 0) throw new Error("banco fora"); return { kind: "all" as const }; } });
    const c = ctx(A, "x", "analyst");
    await expect(resolver(c)).rejects.toThrow("banco fora");
    await new Promise((r) => setTimeout(r, 5));
    expect((await resolver(c)).kind).toBe("all");
  });
});
