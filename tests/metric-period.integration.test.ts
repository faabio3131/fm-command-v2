import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { createMetricService, createUnitComparisonService } from "@/application/metrics/metric-composition";
import { MetricRecomputeService } from "@/application/metrics/metric-recompute-service";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { canonicalFacts, metricValues } from "@/infrastructure/db/platform-schema";
import { orgUnits } from "@/infrastructure/db/unit-schema";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

const T = "periodo-a";
const ctx: TenantContext = { tenantId: T, userId: "owner", role: "owner", correlationId: "c" };
const NOW = new Date("2026-10-16T15:00:00Z");
const metrics = createMetricService();
const store = new PostgresMetricStore();
const units = new PostgresUnitRepository();
let u1: string; let u2: string;

const recompute = () => new MetricRecomputeService({
  metrics, factScopes: (t) => store.distinctFactScopes(t), tenantIds: async () => [T], timeZone: async () => "America/Sao_Paulo", now: () => NOW,
}).recomputeTenant(T, "c");

async function leads(unitId: string, dates: string[]) {
  const sourceId = randomUUID();
  await db.insert(canonicalFacts).values(dates.map((d) => ({
    tenantId: T, unitId, sourceId, externalId: `${unitId}-${d}`, factType: "lead.created", payload: {}, mappingVersion: "v1", sourceTimestamp: new Date(d),
  })));
}
async function cleanup() {
  await db.delete(metricValues).where(inArray(metricValues.tenantId, [T]));
  await db.delete(canonicalFacts).where(inArray(canonicalFacts.tenantId, [T]));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, [T]));
}

beforeAll(async () => {
  await cleanup();
  const company = (await units.createUnit({ tenantId: T, kind: "company", parentId: null, name: "Matriz" })).id;
  u1 = (await units.createUnit({ tenantId: T, kind: "branch", parentId: company, name: "Filial 1" })).id;
  u2 = (await units.createUnit({ tenantId: T, kind: "branch", parentId: company, name: "Filial 2" })).id;
  await leads(u1, ["2026-10-05T12:00:00Z", "2026-10-10T12:00:00Z", "2026-09-15T12:00:00Z", "2026-08-20T12:00:00Z", "2026-02-01T12:00:00Z", "2025-12-31T12:00:00Z"]);
  await leads(u2, ["2026-10-02T12:00:00Z", "2026-09-30T12:00:00Z", "2026-09-01T12:00:00Z"]);
});
afterAll(cleanup);

describe("período escolhível, de ponta a ponta", () => {
  it("cada período devolve a contagem certa para a mesma filial", async () => {
    await recompute();
    const count = async (kind: "current" | "previous" | "quarter" | "year") => (await metrics.query(ctx, "lead.created.count", undefined, u1, kind))?.value;
    expect(await count("current")).toBe("2");
    expect(await count("previous")).toBe("1");
    expect(await count("quarter")).toBe("2");
    expect(await count("year")).toBe("5"); // 31/12/2025 fica de fora
    const previous = await metrics.query(ctx, "lead.created.count", undefined, u1, "previous");
    expect(previous?.periodKind).toBe("previous");
    expect(previous?.periodEnd).toEqual(new Date("2026-10-01T03:00:00Z"));
  });

  it("o padrão continua sendo o mês corrente e recalcular não repete linhas", async () => {
    expect((await metrics.query(ctx, "lead.created.count", undefined, u1))?.value).toBe("2");
    const before = (await db.select().from(metricValues).where(inArray(metricValues.tenantId, [T]))).length;
    await recompute();
    await recompute();
    expect((await db.select().from(metricValues).where(inArray(metricValues.tenantId, [T]))).length).toBe(before);
  });

  it("filial sem fato no período fica sem valor (indisponível), nunca zero", async () => {
    const view = await createUnitComparisonService().compare(ctx, { metricId: "lead.created.count", periodKind: "previous" });
    const byName = Object.fromEntries(view.comparison.branches.map((b) => [b.name, b.value]));
    expect(byName).toEqual({ "Filial 1": "1", "Filial 2": "2" }); // u2: 30/09 e 01/09 ficam em setembro
    const cur = await createUnitComparisonService().compare(ctx, { metricId: "lead.created.count" });
    expect(Object.fromEntries(cur.comparison.branches.map((b) => [b.name, b.value]))).toEqual({ "Filial 1": "2", "Filial 2": "1" });
    expect(view.comparison.total).toMatchObject({ status: "available", value: "3" });
  });

  it("a virada de mês cria o novo período sem apagar o anterior", async () => {
    const next = new MetricRecomputeService({
      metrics, factScopes: (t) => store.distinctFactScopes(t), tenantIds: async () => [T], timeZone: async () => "America/Sao_Paulo", now: () => new Date("2026-11-02T15:00:00Z"),
    });
    await next.recomputeTenant(T, "c");
    // Em novembro o mês anterior é outubro (2 leads da filial 1); o valor de setembro continua guardado no histórico.
    expect((await metrics.query(ctx, "lead.created.count", undefined, u1, "previous"))?.value).toBe("2");
    // Sem nenhum lead em novembro o mês corrente fica indisponível (nulo), nunca zero.
    expect((await metrics.query(ctx, "lead.created.count", undefined, u1, "current"))?.value).toBeNull();
    const rows = await db.select().from(metricValues).where(inArray(metricValues.tenantId, [T]));
    expect(rows.some((r) => r.periodKind === "previous" && r.periodStart?.toISOString() === "2026-09-01T03:00:00.000Z")).toBe(true);
  });
});
