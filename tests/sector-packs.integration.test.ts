import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import { createMetricService, createUnitComparisonService, createMetricRecomputeService } from "@/application/metrics/metric-composition";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { buildReportService } from "@/application/reports/report-composition";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";
import type { Connector, ConnectorFact } from "@/domain/integration/contracts";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { canonicalFacts, metricValues, sourceDefinitions, syncExecutions } from "@/infrastructure/db/platform-schema";
import { sectorPacks } from "@/infrastructure/db/sector-schema";
import { reports } from "@/infrastructure/db/report-schema";
import { orgUnits } from "@/infrastructure/db/unit-schema";
import { PostgresCanonicalFactRepository, PostgresSourceRepository, PostgresSyncRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

const A = "setor-a";
const B = "setor-b";
const sources = new PostgresSourceRepository();
const units = new PostgresUnitRepository();
const metricStore = new PostgresMetricStore();
const ctx = (tenantId: string, role: TenantContext["role"] = "owner"): TenantContext => ({ tenantId, userId: `u-${tenantId}`, role, correlationId: "c" });
let b1: string; let b2: string;

/** Sistema de transporte sintético: entrega registros no contrato do pacote, sem depender de nenhum fornecedor real. */
const now = new Date();
const delivery = (id: string, status: string, amountMinor: number | undefined, unitRef: string): ConnectorFact => ({
  externalId: `delivery:${id}`, factType: "transport.delivery", unitRef, sourceTimestamp: now,
  payload: { status, ...(amountMinor === undefined ? { unavailable: ["amountMinor"] } : { amountMinor, currency: "BRL" }) },
});
const syntheticTms: Connector = {
  sourceType: "tms_sintetico", capabilities: ["pull"],
  async health() { return "healthy"; },
  async pull() {
    return { facts: [
      delivery("1", "settled", 150_000, "F1"), delivery("2", "settled", 25_050, "F1"), delivery("3", "open", 99_999, "F1"),
      delivery("4", "overdue", 10_000, "F1"), delivery("5", "settled", 77_700, "F2"), delivery("6", "cancelled", 5_000, "F2"),
      { externalId: "maint:1", factType: "transport.maintenance", unitRef: "F1", sourceTimestamp: now, payload: { status: "settled", amountMinor: 40_000, currency: "BRL" } },
    ] };
  },
};

async function cleanup() {
  const t = [A, B];
  await db.delete(reports).where(inArray(reports.tenantId, t));
  await db.delete(metricValues).where(inArray(metricValues.tenantId, t));
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, t));
  await db.delete(canonicalFacts).where(inArray(canonicalFacts.tenantId, t));
  await db.delete(syncExecutions).where(inArray(syncExecutions.tenantId, t));
  await db.delete(sourceDefinitions).where(inArray(sourceDefinitions.tenantId, t));
  await db.delete(sectorPacks).where(inArray(sectorPacks.tenantId, t));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, t));
}
beforeAll(async () => {
  await cleanup();
  const hq = await units.createUnit({ tenantId: A, kind: "company", parentId: null, name: "Matriz" });
  b1 = (await units.createUnit({ tenantId: A, kind: "branch", parentId: hq.id, name: "Filial 1" })).id;
  b2 = (await units.createUnit({ tenantId: A, kind: "branch", parentId: hq.id, name: "Filial 2" })).id;
});
afterAll(cleanup);

describe("pacote de transporte ponta a ponta (sistema sintético)", () => {
  it("ligar é por empresa, com permissão e auditoria; só liga o que existe", async () => {
    const sectors = buildSectorService();
    await expect(sectors.setEnabled(ctx(A, "viewer"), "transport", true)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(sectors.setEnabled(ctx(A), "inexistente", true)).rejects.toThrow("sector.pack_not_found");
    await expect(sectors.createSuggestedReport(ctx(A), "transport", "pt-BR")).rejects.toThrow("sector.pack_not_enabled");
    expect((await sectors.visibleMetricIds(A)).has("transport.freight.revenue")).toBe(false);
    await sectors.setEnabled(ctx(A), "transport", true);
    await sectors.setEnabled(ctx(A), "transport", true); // repetir não duplica nem audita de novo
    expect((await sectors.visibleMetricIds(A)).has("transport.freight.revenue")).toBe(true);
    expect((await sectors.visibleMetricIds(A)).has("finance.receivable.open_amount")).toBe(true);
    expect((await sectors.visibleMetricIds(B)).has("transport.freight.revenue")).toBe(false);
    expect(await sectors.isEnabled(B, "transport")).toBe(false);
    const audits = await db.select().from(auditEvents).where(inArray(auditEvents.tenantId, [A, B]));
    expect(audits.filter((a) => a.action === "sector.pack.enabled")).toHaveLength(1);
  });

  it("fatos do sistema sintético viram números exatos por filial e no total", async () => {
    const source = await sources.create(A, {
      name: "TMS", sourceType: "tms_sintetico", authoritativeDomain: "operations", syncMode: "pull",
      config: { unitMap: { F1: b1, F2: b2 } },
    });
    const recompute = createMetricRecomputeService();
    const runtime = new ConnectorRuntime(
      sources, new PostgresSyncRepository(), new PostgresCanonicalFactRepository(), [syntheticTms], undefined, undefined, undefined,
      (tenantId, correlationId) => recompute.recomputeTenant(tenantId, correlationId),
    );
    expect(await runtime.syncPull(ctx(A), { sourceId: source.id, idempotencyKey: "tms-1" })).toMatchObject({ status: "completed", ingested: 7 });

    const v = (id: string, unit: string) => metricStore.latestValue(A, id, undefined, unit);
    expect(await v("transport.freight.revenue", b1)).toMatchObject({ value: "1750.5", unit: "currency", currency: "BRL" });
    expect(await v("transport.freight.revenue", b2)).toMatchObject({ value: "777" });
    expect(await v("transport.deliveries.completed.count", b1)).toMatchObject({ value: "2", unit: "count" });
    expect(await v("transport.deliveries.in_transit.count", b1)).toMatchObject({ value: "2" });
    expect(await v("transport.deliveries.late.count", b1)).toMatchObject({ value: "1" });
    expect(await v("transport.fleet.maintenance_cost", b1)).toMatchObject({ value: "400" });
    expect(await v("transport.fleet.maintenance_cost", b2)).toBeNull(); // sem fato, sem linha: nunca zero inventado

    const { comparison } = await createUnitComparisonService().compare(ctx(A), { metricId: "transport.freight.revenue" });
    expect(comparison.total).toMatchObject({ status: "available", value: "2527.5", reporting: 2, expected: 2 });
    expect(await createMetricService().query(ctx(A), "transport.freight.revenue", undefined, b1)).toMatchObject({ value: "1750.5" });
    // Outra empresa não enxerga nada.
    expect(await metricStore.latestValue(B, "transport.freight.revenue", undefined, b1)).toBeNull();
  });

  it("relatório sugerido nasce uma vez, nos idiomas pedidos, com métricas do pacote", async () => {
    const sectors = buildSectorService();
    expect(await sectors.createSuggestedReport(ctx(A), "transport", "pt-BR")).toEqual({ created: true });
    expect(await sectors.createSuggestedReport(ctx(A), "transport", "pt-BR")).toEqual({ created: false });
    const list = await buildReportService().list(ctx(A));
    expect(list).toHaveLength(1);
    expect(list[0].metricIds.every((id) => id.startsWith("transport."))).toBe(true);
  });

  it("desligar tira as métricas da visão mas não apaga o histórico", async () => {
    const sectors = buildSectorService();
    await sectors.setEnabled(ctx(A), "transport", false);
    expect((await sectors.visibleMetricIds(A)).has("transport.freight.revenue")).toBe(false);
    expect(await metricStore.latestValue(A, "transport.freight.revenue", undefined, b1)).toMatchObject({ value: "1750.5" });
  });
});
