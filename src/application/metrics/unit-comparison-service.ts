import type { MetricService, UnitScopeResolver } from "@/application/metrics/metric-service";
import { DEFAULT_PERIOD_KIND, type PeriodKind } from "@/domain/metrics/period";
import { MAX_SERIES_MONTHS, monthWindows } from "@/domain/metrics/monthly-series";
import { getMetricDefinition } from "@/domain/metrics/registry";
import { compareBranches, selectableRegions, selectBranches, type ConsolidatedTotal, type UnitComparison } from "@/domain/metrics/unit-comparison";
import type { OrgUnit } from "@/domain/organization/unit-hierarchy";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

export interface CompanyConsolidation {
  readonly total: ConsolidatedTotal;
  /** Verdadeiro quando a pessoa enxerga todas as filiais da empresa; falso = soma só do que o escopo dela alcança. */
  readonly fullCompany: boolean;
}

export interface MonthlySeriesPoint {
  readonly key: string;
  /** Falso no mês corrente, que ainda está em andamento. */
  readonly closed: boolean;
  readonly comparison: UnitComparison;
}

export interface MonthlySeries {
  readonly metricId: string;
  readonly points: readonly MonthlySeriesPoint[];
}

export interface UnitComparisonView {
  readonly metricId: string;
  readonly comparison: UnitComparison;
  readonly regions: readonly { readonly id: string; readonly name: string }[];
}

/**
 * Compara filiais para uma métrica: lê pelo MetricService (escopo de unidades em toda leitura) e aplica a regra pura de
 * consolidação. Empresa sem árvore de unidades devolve recorte vazio, que a tela mostra como "sem filiais".
 */
export class UnitComparisonService {
  constructor(
    private readonly metrics: MetricService,
    private readonly listUnits: (tenantId: string) => Promise<readonly OrgUnit[]>,
    private readonly unitScope: UnitScopeResolver,
  ) {}

  async compare(context: TenantContext, input: { metricId: string; regionId?: string; productId?: string; periodKind?: PeriodKind }): Promise<UnitComparisonView> {
    requirePermission(context, "metric:read");
    const definition = getMetricDefinition(input.metricId);
    if (!definition) throw new Error(`metrics.definition_not_found:${input.metricId}`);
    // Métrica de posição (as_of) não tem período: sempre o valor corrente.
    const periodKind = definition.grain === "as_of" ? DEFAULT_PERIOD_KIND : (input.periodKind ?? DEFAULT_PERIOD_KIND);
    const [units, scope] = await Promise.all([this.listUnits(context.tenantId), this.unitScope(context)]);
    const branches = selectBranches(units, scope, input.regionId ?? null);
    const views = await this.metrics.queryUnits(context, input.metricId, branches.map((b) => b.id), input.productId, periodKind);
    const readings = views.flatMap((view) => view.unitId ? [{ unitId: view.unitId, value: view.value, currency: view.currency }] : []);
    return {
      metricId: input.metricId,
      comparison: compareBranches(branches, readings, input.regionId ?? null),
      regions: selectableRegions(units, scope).map((r) => ({ id: r.id, name: r.name })),
    };
  }

  /**
   * Total da empresa a partir das filiais, para várias métricas de uma vez (painel inicial). Soma só filiais, dentro do escopo da pessoa;
   * filial sem valor não entra (nunca vira zero) e moedas diferentes tornam o total indisponível. Só métricas que somam (contagem e soma).
   */
  async consolidate(context: TenantContext, input: { metricIds: readonly string[]; periodKind?: PeriodKind }): Promise<ReadonlyMap<string, CompanyConsolidation>> {
    requirePermission(context, "metric:read");
    const [units, scope] = await Promise.all([this.listUnits(context.tenantId), this.unitScope(context)]);
    const allBranches = units.filter((u) => u.kind === "branch");
    const branches = selectBranches(units, scope, null);
    const out = new Map<string, CompanyConsolidation>();
    for (const metricId of input.metricIds) {
      const definition = getMetricDefinition(metricId);
      if (!definition) continue;
      const periodKind = definition.grain === "as_of" ? DEFAULT_PERIOD_KIND : (input.periodKind ?? DEFAULT_PERIOD_KIND);
      const views = await this.metrics.queryUnits(context, metricId, branches.map((b) => b.id), undefined, periodKind);
      const readings = views.flatMap((view) => view.unitId ? [{ unitId: view.unitId, value: view.value, currency: view.currency }] : []);
      out.set(metricId, { total: compareBranches(branches, readings, null).total, fullCompany: branches.length === allBranches.length });
    }
    return out;
  }
  /**
   * Série mensal da métrica somando as filiais que a pessoa enxerga, mês a mês, calculada dos fatos (não das fotos do recálculo).
   * Mês sem dado em nenhuma filial fica indisponível, nunca zero. Métrica de posição (a receber em aberto, assinaturas ativas) não tem
   * série: o passado não é recuperável do fato atual, então devolve null em vez de inventar. Fuso e calendário são os da empresa.
   */
  async monthlySeries(context: TenantContext, input: { metricId: string; months: number; timeZone: string; now?: Date }): Promise<MonthlySeries | null> {
    requirePermission(context, "metric:read");
    const definition = getMetricDefinition(input.metricId);
    if (!definition) throw new Error(`metrics.definition_not_found:${input.metricId}`);
    if (definition.grain === "as_of") return null;
    if (input.months > MAX_SERIES_MONTHS) throw new Error("metrics.series_months_invalid");
    const [units, scope] = await Promise.all([this.listUnits(context.tenantId), this.unitScope(context)]);
    const branches = selectBranches(units, scope, null);
    const windows = monthWindows(input.now ?? new Date(), input.timeZone, input.months);
    const points = await Promise.all(windows.map(async (window) => {
      const readings = await this.metrics.measureUnitsInWindow(context, input.metricId, branches.map((b) => b.id), window);
      return { key: window.key, closed: window.closed, comparison: compareBranches(branches, readings, null) };
    }));
    return { metricId: input.metricId, points };
  }
}
