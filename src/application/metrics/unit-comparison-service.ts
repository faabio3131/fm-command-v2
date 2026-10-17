import type { MetricService, UnitScopeResolver } from "@/application/metrics/metric-service";
import { DEFAULT_PERIOD_KIND, type PeriodKind } from "@/domain/metrics/period";
import { getMetricDefinition } from "@/domain/metrics/registry";
import { compareBranches, selectableRegions, selectBranches, type UnitComparison } from "@/domain/metrics/unit-comparison";
import type { OrgUnit } from "@/domain/organization/unit-hierarchy";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

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
}
