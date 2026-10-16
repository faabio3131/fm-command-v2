import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { MetricFreshnessStatus, MetricQualityStatus, MetricStore, MetricView } from "@/application/metrics/metric-service";
import { db } from "@/infrastructure/db/client";
import { canonicalFacts, metricValues } from "@/infrastructure/db/platform-schema";

function normalizeFreshness(value: string): MetricFreshnessStatus {
  if (value === "fresh" || value === "delayed" || value === "stale" || value === "unavailable") return value;
  return "unknown";
}
function normalizeQuality(value: string): MetricQualityStatus {
  if (value === "verified" || value === "reconciled" || value === "partial" || value === "estimated" || value === "missing") return value;
  return "unknown";
}
function mapMetric(row: typeof metricValues.$inferSelect): MetricView {
  return {
    productId: row.productId ?? undefined,
    unitId: row.unitId ?? undefined,
    metricId: row.metricId, metricVersion: row.metricVersion, value: row.value, unit: row.unit,
    currency: row.currency ?? undefined, periodStart: row.periodStart ?? undefined, periodEnd: row.periodEnd ?? undefined,
    asOf: row.asOf ?? undefined, computedAt: row.computedAt, sourceTimestamp: row.sourceTimestamp ?? undefined,
    freshnessStatus: normalizeFreshness(row.freshnessStatus), qualityStatus: normalizeQuality(row.qualityStatus),
    sourceAuthority: row.sourceAuthority, provenanceRefs: row.provenanceRefs,
  };
}

export class PostgresMetricStore implements MetricStore {
  async factsForMetric(input: { tenantId: string; productId?: string; unitId?: string; factType: string; periodStart?: Date; periodEnd?: Date }) {
    const clauses = [
      eq(canonicalFacts.tenantId, input.tenantId),
      eq(canonicalFacts.factType, input.factType),
      input.productId ? eq(canonicalFacts.productId, input.productId) : isNull(canonicalFacts.productId),
      // Sem unidade pedida, só dado da empresa; com unidade, só dessa unidade (consolidação é da Fase 2).
      input.unitId ? eq(canonicalFacts.unitId, input.unitId) : isNull(canonicalFacts.unitId),
    ];
    if (input.periodStart) clauses.push(gte(canonicalFacts.sourceTimestamp, input.periodStart));
    if (input.periodEnd) clauses.push(lte(canonicalFacts.sourceTimestamp, input.periodEnd));
    const rows = await db.select().from(canonicalFacts).where(and(...clauses));
    return rows.map((row) => ({
      id: row.id, externalId: row.externalId, factType: row.factType, payload: row.payload,
      sourceTimestamp: row.sourceTimestamp, provenanceRef: row.id,
    }));
  }

  async saveValue(input: {
    tenantId: string; productId?: string; unitId?: string; metricId: string; metricVersion: number; value: string | null; unit: string; currency?: string;
    periodStart?: Date; periodEnd?: Date; asOf?: Date; computedAt: Date; sourceTimestamp?: Date; freshnessStatus: MetricFreshnessStatus;
    qualityStatus: MetricQualityStatus; sourceAuthority: string; provenanceRefs: readonly string[];
  }) {
    await db.insert(metricValues).values({
      tenantId: input.tenantId, productId: input.productId, unitId: input.unitId, metricId: input.metricId, metricVersion: input.metricVersion, value: input.value,
      unit: input.unit, currency: input.currency, periodStart: input.periodStart, periodEnd: input.periodEnd, asOf: input.asOf,
      computedAt: input.computedAt, sourceTimestamp: input.sourceTimestamp, freshnessStatus: input.freshnessStatus,
      qualityStatus: input.qualityStatus, sourceAuthority: input.sourceAuthority, provenanceRefs: [...input.provenanceRefs],
    });
  }

  async latestValue(tenantId: string, metricId: string, productId?: string, unitId?: string): Promise<MetricView | null> {
    const productClause = productId ? eq(metricValues.productId, productId) : isNull(metricValues.productId);
    const unitClause = unitId ? eq(metricValues.unitId, unitId) : isNull(metricValues.unitId);
    const rows = await db.select().from(metricValues).where(and(
      eq(metricValues.tenantId, tenantId), eq(metricValues.metricId, metricId), productClause, unitClause,
    )).orderBy(desc(metricValues.computedAt)).limit(1);
    return rows[0] ? mapMetric(rows[0]) : null;
  }

  /** Último valor de cada unidade pedida, numa só consulta. Unidade sem valor simplesmente não aparece. */
  async latestValuesByUnit(tenantId: string, metricId: string, unitIds: readonly string[], productId?: string): Promise<readonly MetricView[]> {
    if (unitIds.length === 0) return [];
    const productClause = productId ? eq(metricValues.productId, productId) : isNull(metricValues.productId);
    const rows = await db.selectDistinctOn([metricValues.unitId]).from(metricValues).where(and(
      eq(metricValues.tenantId, tenantId), eq(metricValues.metricId, metricId), productClause, inArray(metricValues.unitId, [...unitIds]),
    )).orderBy(metricValues.unitId, desc(metricValues.computedAt));
    return rows.map(mapMetric);
  }

  async recentValues(tenantId: string, metricId: string, productId: string, limit: number, unitId?: string): Promise<readonly MetricView[]> {
    const unitClause = unitId ? eq(metricValues.unitId, unitId) : isNull(metricValues.unitId);
    const rows = await db.select().from(metricValues).where(and(
      eq(metricValues.tenantId, tenantId), eq(metricValues.metricId, metricId), eq(metricValues.productId, productId), unitClause,
    )).orderBy(desc(metricValues.computedAt)).limit(limit);
    return rows.map(mapMetric);
  }
}
