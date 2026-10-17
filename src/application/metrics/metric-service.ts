import { computeMetric, MultiCurrencyAggregationError, type MetricFact } from "@/domain/metrics/metric-engine";
import { DEFAULT_PERIOD_KIND, type PeriodKind } from "@/domain/metrics/period";
import { EXECUTIVE_METRIC_TARGETS, getMetricDefinition } from "@/domain/metrics/registry";
import { assertUnitAccess, canAccessUnit, type UnitScope } from "@/domain/organization/unit-hierarchy";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

export type MetricFreshnessStatus = "fresh" | "delayed" | "stale" | "unknown" | "unavailable";
export type MetricQualityStatus = "verified" | "reconciled" | "partial" | "estimated" | "unknown" | "missing";

export interface MetricStore {
  factsForMetric(input: { tenantId: string; productId?: string; unitId?: string; factType: string; periodStart?: Date; periodEnd?: Date }): Promise<readonly MetricFact[]>;
  saveValue(input: {
    tenantId: string; productId?: string; unitId?: string; metricId: string; metricVersion: number; value: string | null; unit: string; currency?: string;
    periodStart?: Date; periodEnd?: Date; periodKind?: PeriodKind; asOf?: Date; computedAt: Date; sourceTimestamp?: Date; freshnessStatus: MetricFreshnessStatus;
    qualityStatus: MetricQualityStatus; sourceAuthority: string; provenanceRefs: readonly string[];
  }): Promise<void>;
  latestValue(tenantId: string, metricId: string, productId?: string, unitId?: string, periodKind?: PeriodKind): Promise<MetricView | null>;
  recentValues(tenantId: string, metricId: string, productId: string, limit: number, unitId?: string, periodKind?: PeriodKind): Promise<readonly MetricView[]>;
  latestValuesByUnit(tenantId: string, metricId: string, unitIds: readonly string[], productId?: string, periodKind?: PeriodKind): Promise<readonly MetricView[]>;
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
  readonly periodKind?: PeriodKind;
  readonly asOf?: Date;
  readonly computedAt: Date;
  readonly sourceTimestamp?: Date;
  readonly freshnessStatus: MetricFreshnessStatus;
  readonly qualityStatus: MetricQualityStatus;
  readonly sourceAuthority: string;
  readonly provenanceRefs: readonly string[];
}


/** Devolve o escopo de unidades de quem consulta. Obrigatório: não existe MetricService sem escopo (ADR-019). */
export type UnitScopeResolver = (context: TenantContext) => Promise<UnitScope>;

export class MetricService {
  constructor(private readonly store: MetricStore, private readonly unitScope: UnitScopeResolver) {}

  /** Toda leitura ou cálculo de uma unidade passa por aqui; `unitId` ausente é dado da empresa. */
  private async authorizeUnit(context: TenantContext, unitId: string | undefined): Promise<void> {
    assertUnitAccess(await this.unitScope(context), unitId ?? null);
  }

  /** Quem pode ler dado no nível da empresa (unidade nula). Usado por alertas, que ainda não têm unidade. */
  async canReadCompanyLevel(context: TenantContext): Promise<boolean> {
    return canAccessUnit(await this.unitScope(context), null);
  }

  /**
   * Calcula a métrica a partir dos fatos e grava. Com `skipIfUnchanged`, não grava de novo quando o último valor guardado já é
   * igual (mesmo valor, unidade, moeda, qualidade e período): recálculo frequente não enche a tabela de linhas repetidas.
   */
  async recompute(context: TenantContext, input: { metricId: string; productId?: string; unitId?: string; periodStart?: Date; periodEnd?: Date; periodKind?: PeriodKind; asOf?: Date; skipIfUnchanged?: boolean }): Promise<MetricView> {
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
      periodStart: input.periodStart, periodEnd: input.periodEnd, periodKind: input.periodKind ?? DEFAULT_PERIOD_KIND, asOf: input.asOf,
      computedAt: now, sourceTimestamp: computed.status === "available" ? computed.sourceTimestamp : undefined,
      freshnessStatus: computed.status === "available" ? "unknown" : "unavailable",
      qualityStatus: computed.qualityStatus, sourceAuthority: definition.sourceAuthority, provenanceRefs: computed.provenanceRefs,
    };
    if (input.skipIfUnchanged) {
      const last = await this.store.latestValue(context.tenantId, definition.metricId, input.productId, input.unitId, value.periodKind);
      const same = (a?: Date, b?: Date) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
      if (last && last.value === value.value && last.unit === value.unit && (last.currency ?? null) === (value.currency ?? null)
        && last.qualityStatus === value.qualityStatus && same(last.periodStart, value.periodStart)
        && same(last.sourceTimestamp, value.sourceTimestamp)) return last;
    }
    await this.store.saveValue({ tenantId: context.tenantId, ...value });
    return value;
  }

  async query(context: TenantContext, metricId: string, productId?: string, unitId?: string, periodKind: PeriodKind = DEFAULT_PERIOD_KIND): Promise<MetricView | null> {
    requirePermission(context, "metric:read");
    if (!getMetricDefinition(metricId)) throw new Error(`metrics.definition_not_found:${metricId}`);
    await this.authorizeUnit(context, unitId);
    return this.store.latestValue(context.tenantId, metricId, productId, unitId, periodKind);
  }

  /** Último valor de cada unidade pedida. Cada unidade passa pelo escopo; pedir uma de fora nega a consulta inteira. */
  async queryUnits(context: TenantContext, metricId: string, unitIds: readonly string[], productId?: string, periodKind: PeriodKind = DEFAULT_PERIOD_KIND): Promise<readonly MetricView[]> {
    requirePermission(context, "metric:read");
    if (!getMetricDefinition(metricId)) throw new Error(`metrics.definition_not_found:${metricId}`);
    const scope = await this.unitScope(context);
    for (const unitId of unitIds) assertUnitAccess(scope, unitId);
    return this.store.latestValuesByUnit(context.tenantId, metricId, unitIds, productId, periodKind);
  }

  /**
   * Valor de cada unidade pedida em uma janela de datas, calculado agora a partir dos fatos e NÃO gravado (leitura pura, usada na série
   * histórica). Unidade sem fato na janela, ou com moedas misturadas, volta com valor nulo: indisponível, nunca zero.
   */
  async measureUnitsInWindow(context: TenantContext, metricId: string, unitIds: readonly string[], window: { periodStart: Date; periodEnd: Date }): Promise<readonly { unitId: string; value: string | null; currency?: string }[]> {
    requirePermission(context, "metric:read");
    const definition = getMetricDefinition(metricId);
    if (!definition) throw new Error(`metrics.definition_not_found:${metricId}`);
    const scope = await this.unitScope(context);
    for (const unitId of unitIds) assertUnitAccess(scope, unitId);
    return Promise.all(unitIds.map(async (unitId) => {
      const facts = await this.store.factsForMetric({ tenantId: context.tenantId, unitId, factType: definition.factType, periodStart: window.periodStart, periodEnd: window.periodEnd });
      try {
        const computed = computeMetric(definition, facts);
        return computed.status === "available" ? { unitId, value: computed.value, currency: computed.currency } : { unitId, value: null };
      } catch (error) {
        if (error instanceof MultiCurrencyAggregationError) return { unitId, value: null };
        throw error;
      }
    }));
  }

  async history(context: TenantContext, metricId: string, productId: string, limit = 2, unitId?: string): Promise<readonly MetricView[]> {
    requirePermission(context, "metric:read");
    if (!getMetricDefinition(metricId)) throw new Error(`metrics.definition_not_found:${metricId}`);
    if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error("metrics.history_limit_invalid");
    await this.authorizeUnit(context, unitId);
    return this.store.recentValues(context.tenantId, metricId, productId, limit, unitId);
  }

  async overview(context: TenantContext, productId?: string, unitId?: string, periodKind: PeriodKind = DEFAULT_PERIOD_KIND) {
    requirePermission(context, "metric:read");
    await this.authorizeUnit(context, unitId);
    return Promise.all(EXECUTIVE_METRIC_TARGETS.map(async (target) => {
      const definition = getMetricDefinition(target.metricId);
      return {
        target,
        definition,
        value: definition
          ? await this.store.latestValue(context.tenantId, definition.metricId, productId, unitId, definition.grain === "as_of" ? DEFAULT_PERIOD_KIND : periodKind)
          : null,
      };
    }));
  }
}
