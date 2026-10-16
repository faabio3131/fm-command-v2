import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { MetricService } from "@/application/metrics/metric-service";
import { UnitAccessDeniedError } from "@/domain/organization/unit-hierarchy";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { canonicalFacts, metricValues } from "@/infrastructure/db/platform-schema";
import { orgUnits, unitGrants } from "@/infrastructure/db/unit-schema";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresUnitRepository, UnitValidationError } from "@/infrastructure/organization/postgres-unit-repository";

const A = "unidades-empresa-a";
const B = "unidades-empresa-b";
const repo = new PostgresUnitRepository();
const store = new PostgresMetricStore();
const metricId = METRIC_REGISTRY[0].metricId;
const ctx = (tenantId: string, userId: string, role: TenantContext["role"]): TenantContext =>
  ({ tenantId, userId, role, correlationId: `c-${userId}` });

let hq: string, sul: string, cwb: string, poa: string, sp: string, hqB: string, brB: string;

async function cleanup() {
  await db.delete(metricValues).where(inArray(metricValues.tenantId, [A, B]));
  await db.delete(canonicalFacts).where(inArray(canonicalFacts.tenantId, [A, B]));
  await db.delete(unitGrants).where(inArray(unitGrants.tenantId, [A, B]));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, [A, B]));
}

const value = (tenantId: string, unitId: string | undefined, v: string) => store.saveValue({
  tenantId, unitId, metricId, metricVersion: 1, value: v, unit: "count", computedAt: new Date(), freshnessStatus: "fresh",
  qualityStatus: "verified", sourceAuthority: "teste", provenanceRefs: [],
});

beforeAll(async () => {
  await cleanup();
  hq = (await repo.createUnit({ tenantId: A, kind: "company", parentId: null, name: "Matriz SP", countryCode: "BR", currency: "BRL" })).id;
  sul = (await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "Sul" })).id;
  cwb = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: sul, name: "Curitiba" })).id;
  poa = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: sul, name: "Porto Alegre" })).id;
  sp = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: hq, name: "São Paulo" })).id;
  hqB = (await repo.createUnit({ tenantId: B, kind: "company", parentId: null, name: "Outra empresa" })).id;
  brB = (await repo.createUnit({ tenantId: B, kind: "branch", parentId: hqB, name: "Filial B" })).id;
  await value(A, cwb, "10"); await value(A, poa, "20"); await value(A, sp, "30"); await value(A, undefined, "60");
  await value(B, brB, "999");
});
afterAll(cleanup);

describe("isolamento entre empresas (banco)", () => {
  it("a regra do app recusa pai de outra empresa", async () => {
    await expect(repo.createUnit({ tenantId: A, kind: "branch", parentId: brB, name: "intrusa" })).rejects.toBeInstanceOf(UnitValidationError);
  });
  it("o banco recusa pai de outra empresa mesmo sem passar pelo app", async () => {
    await expect(db.insert(orgUnits).values({ tenantId: A, parentId: brB, kind: "branch", name: "intrusa" })).rejects.toThrow();
    expect((await repo.listUnits(A)).some((u) => u.name === "intrusa")).toBe(false);
  });
  it("o banco recusa segunda matriz, matriz com pai, pais e moeda fora do padrao", async () => {
    await expect(db.insert(orgUnits).values({ tenantId: A, kind: "company", name: "segunda" })).rejects.toThrow();
    await expect(db.insert(orgUnits).values({ tenantId: A, kind: "company", parentId: hq, name: "x" })).rejects.toThrow();
    await expect(db.insert(orgUnits).values({ tenantId: A, kind: "branch", parentId: hq, name: "x", countryCode: "br" })).rejects.toThrow();
    await expect(db.insert(orgUnits).values({ tenantId: A, kind: "branch", parentId: hq, name: "x", currency: "real" })).rejects.toThrow();
  });
  it("concessao e metrica nao apontam para unidade de outra empresa", async () => {
    await expect(repo.grant({ tenantId: A, userId: "ana", unitId: brB, grantedBy: "dono" })).rejects.toThrow();
    await expect(value(A, brB, "1")).rejects.toThrow();
    await expect(db.insert(canonicalFacts).values({
      tenantId: A, unitId: brB, sourceId: randomUUID(), externalId: "x", factType: "t", payload: {}, mappingVersion: "1", sourceTimestamp: new Date(),
    })).rejects.toThrow();
  });
  it("listar unidades e concessoes nunca atravessa empresas", async () => {
    expect((await repo.listUnits(A)).every((u) => u.tenantId === A)).toBe(true);
    expect((await repo.listUnits(B)).map((u) => u.id).sort()).toEqual([hqB, brB].sort());
    expect(await repo.listGrants(B, "ana")).toEqual([]);
  });
  it("dado da empresa B nao aparece para A, nem pedindo a unidade de B", async () => {
    expect(await store.latestValue(A, metricId, undefined, brB)).toBeNull();
    expect((await store.latestValue(B, metricId, undefined, brB))?.value).toBe("999");
  });
});

describe("isolamento entre unidades da mesma empresa", () => {
  const service = () => new MetricService(store, (c) => repo.scopeFor(c));

  it("gerente de filial ve so a sua unidade", async () => {
    await repo.grant({ tenantId: A, userId: "gerente-cwb", unitId: cwb, grantedBy: "dono" });
    const c = ctx(A, "gerente-cwb", "member");
    expect((await service().query(c, metricId, undefined, cwb))?.value).toBe("10");
    await expect(service().query(c, metricId, undefined, poa)).rejects.toBeInstanceOf(UnitAccessDeniedError);
    await expect(service().query(c, metricId, undefined, sp)).rejects.toBeInstanceOf(UnitAccessDeniedError);
    await expect(service().query(c, metricId)).rejects.toBeInstanceOf(UnitAccessDeniedError); // dado da empresa
    await expect(service().overview(c, undefined, poa)).rejects.toBeInstanceOf(UnitAccessDeniedError);
    await expect(service().history(c, metricId, randomUUID(), 2, poa)).rejects.toBeInstanceOf(UnitAccessDeniedError);
  });
  it("diretor regional (regiao) ve as filiais abaixo e nao as outras", async () => {
    await repo.grant({ tenantId: A, userId: "diretor-sul", unitId: sul, grantedBy: "dono" });
    const c = ctx(A, "diretor-sul", "analyst");
    expect((await service().query(c, metricId, undefined, cwb))?.value).toBe("10");
    expect((await service().query(c, metricId, undefined, poa))?.value).toBe("20");
    await expect(service().query(c, metricId, undefined, sp)).rejects.toBeInstanceOf(UnitAccessDeniedError);
  });
  it("dono e administrador veem tudo, inclusive dado da empresa", async () => {
    const dono = ctx(A, "dono", "owner");
    expect((await service().query(dono, metricId))?.value).toBe("60");
    expect((await service().query(dono, metricId, undefined, sp))?.value).toBe("30");
    expect((await service().query(ctx(A, "adm", "admin"), metricId, undefined, poa))?.value).toBe("20");
  });
  it("sem concessao, leitor nao ve nada", async () => {
    const c = ctx(A, "leitor-sem-concessao", "viewer");
    await expect(service().query(c, metricId, undefined, cwb)).rejects.toBeInstanceOf(UnitAccessDeniedError);
    await expect(service().query(c, metricId)).rejects.toBeInstanceOf(UnitAccessDeniedError);
  });
  it("concessao dada em outra empresa nao vale aqui", async () => {
    await repo.grant({ tenantId: B, userId: "intruso", unitId: brB, grantedBy: "dono-b" });
    const c = ctx(A, "intruso", "member");
    await expect(service().query(c, metricId, undefined, cwb)).rejects.toBeInstanceOf(UnitAccessDeniedError);
  });
  it("revogar a concessao tira o acesso", async () => {
    await repo.revoke(A, "gerente-cwb", cwb);
    await expect(service().query(ctx(A, "gerente-cwb", "member"), metricId, undefined, cwb)).rejects.toBeInstanceOf(UnitAccessDeniedError);
  });
});

describe("edicao da arvore", () => {
  it("duas mudancas simultaneas que formariam ciclo: so uma vence e a arvore continua sem ciclo", async () => {
    const r1 = await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "R1" });
    const r2 = await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "R2" });
    const results = await Promise.allSettled([repo.moveUnit(A, r1.id, r2.id), repo.moveUnit(A, r2.id, r1.id)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const units = await repo.listUnits(A);
    const byId = new Map(units.map((u) => [u.id, u]));
    for (const u of units) {
      let cur = u; let steps = 0;
      while (cur.parentId !== null) { cur = byId.get(cur.parentId) as typeof cur; steps += 1; expect(steps).toBeLessThan(20); }
    }
  });
  it("mover filial para baixo de filial e recusado", async () => {
    await expect(repo.moveUnit(A, sp, cwb)).rejects.toBeInstanceOf(UnitValidationError);
  });
  it("apagar concessao em cascata quando a unidade some nao deixa lixo", async () => {
    const tmp = await repo.createUnit({ tenantId: A, kind: "branch", parentId: hq, name: "Temporaria" });
    await repo.grant({ tenantId: A, userId: "tmp", unitId: tmp.id, grantedBy: "dono" });
    await db.delete(orgUnits).where(eq(orgUnits.id, tmp.id));
    expect(await repo.listGrants(A, "tmp")).toEqual([]);
  });
  it("fatos so voltam para a unidade pedida", async () => {
    const sourceId = randomUUID();
    const base = { tenantId: A, sourceId, factType: "teste.unidade", mappingVersion: "1", sourceTimestamp: new Date() };
    await db.insert(canonicalFacts).values([
      { ...base, unitId: cwb, externalId: "1", payload: { v: 1 } },
      { ...base, unitId: poa, externalId: "2", payload: { v: 2 } },
      { ...base, externalId: "3", payload: { v: 3 } },
    ]);
    const only = await store.factsForMetric({ tenantId: A, factType: "teste.unidade", unitId: cwb });
    expect(only.map((f) => f.externalId)).toEqual(["1"]);
    const company = await store.factsForMetric({ tenantId: A, factType: "teste.unidade" });
    expect(company.map((f) => f.externalId)).toEqual(["3"]);
    expect(sql``).toBeDefined();
  });
});
