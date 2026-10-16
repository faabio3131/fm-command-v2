import { computeMetric, type MetricFact } from "@/domain/metrics/metric-engine";
import { EXECUTIVE_METRIC_TARGETS, getMetricDefinition } from "@/domain/metrics/registry";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

export type MetricFreshnessStatus = "fresh" | "delayed" | "stale" | "unknown" | "unavailable";
export type MetricQualityStatus = "verified" | "reconciled" | "partial" | "estimated" | "unknown" | "missing";

export interface MetricStore {
  factsForMetric(input: { tenantId: string; productId?: string; factType: string; periodStart?: Date; periodEnd?: Date }): Promise<readonly MetricFact[]>;
  saveValue(input: {
    tenantId: string; productId?: string; metricId: string; metricVersion: number; value: string | null; unit: string; currency?: string;
    periodStart?: Date; periodEnd?: Date; asOf?: Date; computedAt: Date; sourceTimestamp?: Date; freshnessStatus: MetricFreshnessStatus;
    qualityStatus: MetricQualityStatus; sourceAuthority: string; provenanceRefs: readonly string[];
  }): Promise<void>;
  latestValue(tenantId: string, metricId: string, productId?: string): Promise<MetricView | null>;
  recentValues(tenantId: string, metricId: string, productId: string, limit: number): Promise<readonly MetricView[]>;
}

export interface MetricView {
  readonly productId?: string;
  readonly metricId: string;
  readonly metricVersion: number;
  readonly value: string | null;
  readonly unit: string;
  readonly currency?: string;
  readonly periodStart?: Date;
  readonly periodEnd?: Date;
  readonly asOf?: Date;
  readonly computedAt: Date;
  readonly sourceTimestamp?: Date;
  readonly freshnessStatus: MetricFreshnessStatus;
  readonly qualityStatus: MetricQualityStatus;
  readonly sourceAuthority: string;
  readonly provenanceRefs: readonly string[];
}

export class MetricService {
  constructor(private readonly store: MetricStore) {}

  async recompute(context: TenantContext, input: { metricId: string; productId?: string; periodStart?: Date; periodEnd?: Date; asOf?: Date }): Promise<MetricView> {
    requirePermission(context, "metric:read");
    const definition = getMetricDefinition(input.metricId);
    if (!definition) throw new Error(`metrics.definition_not_found:${input.metricId}`);
    const facts = await this.store.factsForMetric({
      tenantId: context.tenantId, productId: input.productId, factType: definition.factType,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
    });
    const computed = computeMetric(definition, facts);
    const now = new Date();
    const value: MetricView = {
      productId: input.productId, metricId: definition.metricId, metricVersion: definition.version, value: computed.value,
      unit: computed.unit, currency: computed.status === "available" ? computed.currency : undefined,
      periodStart: input.periodStart, periodEnd: input.periodEnd, asOf: input.asOf,
      computedAt: now, sourceTimestamp: computed.status === "available" ? computed.sourceTimestamp : undefined,
      freshnessStatus: computed.status === "available" ? "unknown" : "unavailable",
      qualityStatus: computed.qualityStatus, sourceAuthority: definition.sourceAuthority, provenanceRefs: computed.provenanceRefs,
    };
    await this.store.saveValue({ tenantId: context.tenantId, ...value });
    return value;
  }

  async query(context: TenantContext, metricId: string, productId?: string): Promise<MetricView | null> {
    requirePermission(context, "metric:read");
    if (!getMetricDefinition(metricId)) throw new Error(`metrics.definition_not_found:${metricId}`);
    return this.store.latestValue(context.tenantId, metricId, productId);
  }

  async history(context: TenantContext, metricId: string, productId: string, limit = 2): Promise<readonly MetricView[]> {
    requirePermission(context, "metric:read");
    if (!getMetricDefinition(metricId)) throw new Error(`metrics.definition_not_found:${metricId}`);
    if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error("metrics.history_limit_invalid");
    return this.store.recentValues(context.tenantId, metricId, productId, limit);
  }

  async overview(context: TenantContext, productId?: string) {
    requirePermission(context, "metric:read");
    return Promise.all(EXECUTIVE_METRIC_TARGETS.map(async (target) => {
      const definition = getMetricDefinition(target.metricId);
      return {
        target,
        definition,
        value: definition
          ? await this.store.latestValue(context.tenantId, definition.metricId, productId)
          : null,
      };
    }));
  }
}
