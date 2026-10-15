import { computeMetric, type MetricFact } from "@/domain/metrics/metric-engine";
import { EXECUTIVE_METRIC_TARGETS, getMetricDefinition } from "@/domain/metrics/registry";
import { assertUnitAccess, type UnitScope } from "@/domain/organization/unit-hierarchy";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

export type MetricFreshnessStatus = "fresh" | "delayed" | "stale" | "unknown" | "unavailable";
export type MetricQualityStatus = "verified" | "reconciled" | "partial" | "estimated" | "unknown" | "missing";

export interface MetricStore {
  factsForMetric(input: { tenantId: string; productId?: string; unitId?: string; factType: string; periodStart?: Date; periodEnd?: Date }): Promise<readonly MetricFact[]>;
  saveValue(input: {
    tenantId: string; productId?: string; unitId?: string; metricId: string; metricVersion: number; value: string | null; unit: string; currency?: string;
    periodStart?: Date; periodEnd?: Date; asOf?: Date; computedAt: Date; sourceTimestamp?: Date; freshnessStatus: MetricFreshnessStatus;
    qualityStatus: MetricQualityStatus; sourceAuthority: string; provenanceRefs: readonly string[];
  }): Promise<void>;
  latestValue(tenantId: string, metricId: string, productId?: string, unitId?: string): Promise<MetricView | null>;
  recentValues(tenantId: string, metricId: string, productId: string, limit: number, unitId?: string): Promise<readonly MetricView[]>;
}

export interface MetricView {
  readonly productId?: string;
  /** Unidade de origem. Ausente = dado no nível da empresa. */
  readonly unitId?: string;
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

export class UnitScopeNotConfiguredError extends Error {
  constructor() { super("metrics.unit_scope_not_configured"); }
}

/** Devolve o escopo de unidades de quem consulta. Sem resolvedor, não há restrição por unidade (V1). */
export type UnitScopeResolver = (context: TenantContext) => Promise<UnitScope>;

export class MetricService {
  constructor(private readonly store: MetricStore, private readonly unitScope?: UnitScopeResolver) {}

  /** Toda leitura ou cálculo de uma unidade passa por aqui; `unitId` ausente é dado da empresa. */
  private async authorizeUnit(context: TenantContext, unitId: string | undefined): Promise<void> {
    if (!this.unitScope) {
      // Sem resolvedor não há como provar acesso: pedir uma unidade falha fechado (nunca pula a checagem).
      if (unitId !== undefined) throw new UnitScopeNotConfiguredError();
      return;
    }
    assertUnitAccess(await this.unitScope(context), unitId ?? null);
  }

  async recompute(context: TenantContext, input: { metricId: string; productId?: string; unitId?: string; periodStart?: Date; periodEnd?: Date; asOf?: Date }): Promise<MetricView> {
    requirePermission(context, "metric:read");
    const definition = getMetricDefinition(input.metricId);
    if (!definition) throw new Error(`metrics.definition_not_found:${input.metricId}`);
    await this.authorizeUnit(context, input.unitId);
    const facts = await this.store.factsForMetric({
      tenantId: context.tenantId, productId: input.productId, unitId: input.unitId, factType: definition.factType,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
    });
    const computed = computeMetric(definition, facts);
    const now = new Date();
    const value: MetricView = {
      productId: input.productId, unitId: input.unitId, metricId: definition.metricId, metricVersion: definition.version, value: computed.value,
      unit: computed.unit, currency: computed.status === "available" ? computed.currency : undefined,
      periodStart: input.periodStart, periodEnd: input.periodEnd, asOf: input.asOf,
      computedAt: now, sourceTimestamp: computed.status === "available" ? computed.sourceTimestamp : undefined,
      freshnessStatus: computed.status === "available" ? "unknown" : "unavailable",
      qualityStatus: computed.qualityStatus, sourceAuthority: definition.sourceAuthority, provenanceRefs: computed.provenanceRefs,
    };
    await this.store.saveValue({ tenantId: context.tenantId, ...value });
    return value;
  }

  async query(context: TenantContext, metricId: string, productId?: string, unitId?: string): Promise<MetricView | null> {
    requirePermission(context, "metric:read");
    if (!getMetricDefinition(metricId)) throw new Error(`metrics.definition_not_found:${metricId}`);
    await this.authorizeUnit(context, unitId);
    return this.store.latestValue(context.tenantId, metricId, productId, unitId);
  }

  async history(context: TenantContext, metricId: string, productId: string, limit = 2, unitId?: string): Promise<readonly MetricView[]> {
    requirePermission(context, "metric:read");
    if (!getMetricDefinition(metricId)) throw new Error(`metrics.definition_not_found:${metricId}`);
    if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error("metrics.history_limit_invalid");
    await this.authorizeUnit(context, unitId);
    return this.store.recentValues(context.tenantId, metricId, productId, limit, unitId);
  }

  async overview(context: TenantContext, productId?: string, unitId?: string) {
    requirePermission(context, "metric:read");
    await this.authorizeUnit(context, unitId);
    return Promise.all(EXECUTIVE_METRIC_TARGETS.map(async (target) => {
      const definition = getMetricDefinition(target.metricId);
      return {
        target,
        definition,
        value: definition
          ? await this.store.latestValue(context.tenantId, definition.metricId, productId, unitId)
          : null,
      };
    }));
  }
}
