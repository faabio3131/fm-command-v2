import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { createUnitComparisonService } from "@/application/metrics/metric-composition";
import { RegionOutOfScopeError } from "@/domain/metrics/unit-comparison";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { metricValues } from "@/infrastructure/db/platform-schema";
import { orgUnits, unitGrants } from "@/infrastructure/db/unit-schema";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

const A = "comparacao-a";
const B = "comparacao-b"; // outra empresa: nunca aparece em A
const METRIC = "revenue.cash_collected";
const repo = new PostgresUnitRepository();
const store = new PostgresMetricStore();
const ctx = (tenantId: string, userId: string, role: TenantContext["role"]): TenantContext => ({ tenantId, userId, role, correlationId: `c-${userId}` });
const service = () => createUnitComparisonService();
let hq: string, sul: string, norte: string, cwb: string, poa: string, man: string, sp: string;

const save = (tenantId: string, unitId: string | undefined, value: string | null, currency = "BRL", computedAt = new Date()) => store.saveValue({
  tenantId, unitId, metricId: METRIC, metricVersion: 1, value, unit: "currency", currency, computedAt, freshnessStatus: "fresh",
  qualityStatus: "verified", sourceAuthority: "teste", provenanceRefs: [],
});
async function cleanup() {
  await db.delete(metricValues).where(inArray(metricValues.tenantId, [A, B]));
  await db.delete(unitGrants).where(inArray(unitGrants.tenantId, [A, B]));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, [A, B]));
}

beforeAll(async () => {
  await cleanup();
  hq = (await repo.createUnit({ tenantId: A, kind: "company", parentId: null, name: "Matriz" })).id;
  sul = (await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "Sul" })).id;
  norte = (await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "Norte" })).id;
  cwb = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: sul, name: "Curitiba" })).id;
  poa = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: sul, name: "Porto Alegre" })).id;
  man = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: norte, name: "Manaus" })).id;
  sp = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: hq, name: "São Paulo" })).id;
  await repo.grant({ tenantId: A, userId: "gerente-sul", unitId: sul, grantedBy: "owner" });
  // Curitiba tem um valor antigo e um novo: vale o mais novo. Manaus não tem valor. A matriz e a região guardam valores que não podem contar em dobro.
  await save(A, cwb, "999", "BRL", new Date("2026-01-01T00:00:00Z"));
  await save(A, cwb, "100.10");
  await save(A, poa, "300.20");
  await save(A, sp, "50");
  await save(A, hq, "5000"); await save(A, sul, "7000");
  await save(B, undefined, "1");
});
afterAll(cleanup);

describe("comparação entre filiais com banco", () => {
  it("dono: soma exata das filiais com valor; Manaus (sem valor) fica indisponível e fora da soma; matriz e região não contam", async () => {
    const view = await service().compare(ctx(A, "dono", "owner"), { metricId: METRIC });
    expect(view.comparison.total).toEqual({ status: "available", value: "450.3", currency: "BRL", reporting: 3, expected: 4, partial: true });
    expect(view.comparison.branches.map((b) => [b.name, b.value, b.rank])).toEqual([
      ["Porto Alegre", "300.20", 1], ["Curitiba", "100.10", 2], ["São Paulo", "50", 3], ["Manaus", null, null],
    ]);
    expect(view.regions.map((r) => r.name)).toEqual(["Norte", "Sul"]);
  });

  it("filtro por região restringe o recorte e o total", async () => {
    const view = await service().compare(ctx(A, "dono", "owner"), { metricId: METRIC, regionId: sul });
    expect(view.comparison.branches.map((b) => b.name)).toEqual(["Porto Alegre", "Curitiba"]);
    expect(view.comparison.total).toMatchObject({ status: "available", value: "400.3", reporting: 2, expected: 2, partial: false });
    const norteView = await service().compare(ctx(A, "dono", "owner"), { metricId: METRIC, regionId: norte });
    expect(norteView.comparison.total).toEqual({ status: "unavailable", reason: "no_data", reporting: 0, expected: 1 });
  });

  it("gerente do Sul só enxerga o Sul; pedir outra região nega do mesmo jeito que região inexistente", async () => {
    const g = ctx(A, "gerente-sul", "analyst");
    const view = await service().compare(g, { metricId: METRIC });
    expect(view.comparison.branches.map((b) => b.name)).toEqual(["Porto Alegre", "Curitiba"]);
    expect(view.regions.map((r) => r.name)).toEqual(["Sul"]);
    await expect(service().compare(g, { metricId: METRIC, regionId: norte })).rejects.toBeInstanceOf(RegionOutOfScopeError);
    await expect(service().compare(g, { metricId: METRIC, regionId: "inexistente" })).rejects.toBeInstanceOf(RegionOutOfScopeError);
  });

  it("métrica desconhecida é recusada (todos os papéis têm metric:read; o que protege aqui é o escopo)", async () => {
    await expect(service().compare(ctx(A, "dono", "owner"), { metricId: "inexistente" })).rejects.toThrow("metrics.definition_not_found");
  });

  it("isolamento entre empresas: outra empresa não vê as filiais de A nem o contrário", async () => {
    const other = await service().compare(ctx(B, "dono-b", "owner"), { metricId: METRIC });
    expect(other.comparison.branches).toEqual([]);
    expect(other.comparison.total).toMatchObject({ status: "unavailable", reason: "no_branches" });
    await expect(service().compare(ctx(B, "dono-b", "owner"), { metricId: METRIC, regionId: sul })).rejects.toBeInstanceOf(RegionOutOfScopeError);
  });

  it("moedas diferentes entre filiais: sem soma e sem ranking", async () => {
    await save(A, man, "10", "USD");
    const view = await service().compare(ctx(A, "dono", "owner"), { metricId: METRIC });
    expect(view.comparison.total).toMatchObject({ status: "unavailable", reason: "mixed_currency" });
    expect(view.comparison.rankingSuspended).toBe(true);
    expect(view.comparison.branches.every((b) => b.rank === null)).toBe(true);
  });

  it("valor guardado como indisponível (nulo) não vira zero", async () => {
    await save(A, man, null, "BRL", new Date(Date.now() + 1000));
    const view = await service().compare(ctx(A, "dono", "owner"), { metricId: METRIC });
    const manaus = view.comparison.branches.find((b) => b.name === "Manaus");
    expect(manaus).toMatchObject({ value: null, rank: null, sharePercent: null });
    expect(view.comparison.total).toMatchObject({ status: "available", value: "450.3" });
  });
});
