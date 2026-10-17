import type { MetricService } from "@/application/metrics/metric-service";
import { rankByDimension, type DimensionRankRow, type DimensionRanking } from "@/domain/metrics/dimension-ranking";
import { DEFAULT_PERIOD_KIND, resolvePeriod, type PeriodKind } from "@/domain/metrics/period";
import { getMetricDefinition } from "@/domain/metrics/registry";
import { selectBranches } from "@/domain/metrics/unit-comparison";
import type { OrgUnit } from "@/domain/organization/unit-hierarchy";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import type { UnitScopeResolver } from "@/application/metrics/metric-service";

export interface DimensionRankingView {
  readonly metricId: string;
  readonly dimension: string;
  readonly ranking: DimensionRanking;
  /** Quantos grupos têm posição (valor disponível), antes do corte por `limit`. */
  readonly rankedCount: number;
  /** Grupos com o menor valor (do fim da lista inteira, antes do corte); nulo com menos de dois ou se todos empatam em primeiro. */
  readonly lowest: readonly DimensionRankRow[] | null;
  readonly periodKind: PeriodKind;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  /** Filiais lidas (as que o escopo da pessoa alcança). Zero = empresa sem filiais ou sem acesso. */
  readonly branchCount: number;
  /** Verdadeiro quando o ranking cobre todas as filiais da empresa; falso = só o que o escopo da pessoa alcança. */
  readonly fullCompany: boolean;
}

/**
 * Ranking por dimensão dos fatos (ex.: produtos mais vendidos) somando as filiais que a pessoa enxerga.
 * Lê pelo MetricService (escopo de unidades em toda leitura, ADR-019) e aplica a regra pura de `rankByDimension`.
 * Só dado de filiais: dado no nível da empresa (sem unidade) não entra, como na consolidação.
 */
export class DimensionRankingService {
  constructor(
    private readonly metrics: MetricService,
    private readonly listUnits: (tenantId: string) => Promise<readonly OrgUnit[]>,
    private readonly unitScope: UnitScopeResolver,
  ) {}

  async rank(context: TenantContext, input: { metricId: string; dimension: string; timeZone: string; periodKind?: PeriodKind; limit?: number; now?: Date }): Promise<DimensionRankingView> {
    requirePermission(context, "metric:read");
    const definition = getMetricDefinition(input.metricId);
    if (!definition) throw new Error(`metrics.definition_not_found:${input.metricId}`);
    if (definition.grain !== "period") throw new Error(`metrics.ranking_period_required:${input.metricId}`);
    const limit = input.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("metrics.ranking_limit_invalid");
    const periodKind = input.periodKind ?? DEFAULT_PERIOD_KIND;
    const period = resolvePeriod(periodKind, input.now ?? new Date(), input.timeZone);
    const [units, scope] = await Promise.all([this.listUnits(context.tenantId), this.unitScope(context)]);
    const branches = selectBranches(units, scope, null);
    const facts = await this.metrics.factsInWindow(context, input.metricId, branches.map((b) => b.id), period);
    const full = rankByDimension(definition, facts, input.dimension);
    // O limite corta só a lista mostrada; o total e a participação continuam sobre todos os produtos.
    const ranking: DimensionRanking = { ...full, rows: full.rows.slice(0, limit) };
    const ranked = full.rows.filter((row) => row.rank !== null);
    const lastRank = ranked.length ? Math.max(...ranked.map((row) => row.rank as number)) : 0;
    const lowest = ranked.length >= 2 && lastRank > 1 ? ranked.filter((row) => row.rank === lastRank) : null;
    return {
      metricId: input.metricId, dimension: input.dimension, ranking, rankedCount: ranked.length, lowest, periodKind,
      periodStart: period.periodStart, periodEnd: period.periodEnd, branchCount: branches.length,
      fullCompany: branches.length === units.filter((u) => u.kind === "branch").length,
    };
  }
}
