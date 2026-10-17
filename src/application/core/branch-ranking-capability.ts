import type { UnitComparisonService } from "@/application/metrics/unit-comparison-service";
import type { CoreReadCapability, CoreReadCapabilityResult } from "@/domain/core/read-capability";
import { higherIsWorse } from "@/domain/metrics/polarity";
import { rankingHighlights } from "@/domain/metrics/ranking-highlights";
import { METRIC_REGISTRY, getMetricDefinition } from "@/domain/metrics/registry";
import type { TenantContext } from "@/domain/security/tenant-context";

/** Métrica usada quando a pergunta pede ranking de "vendas" sem que o plano escolha uma. */
export const DEFAULT_RANKING_METRIC = "billing.gross_billed";
/** Limite de métricas por pergunta: cada uma é uma leitura por filial. */
const MAX_RANKED_METRICS = 3;
const SOURCE_REF = "branch-ranking";

const rankable = (metricId: string): boolean => {
  const m = getMetricDefinition(metricId);
  return !!m && (m.kind === "sum" || m.kind === "count") && m.grain === "period";
};

/**
 * "Qual loja vendeu mais, a segunda, a terceira, a pior?" Os números e as posições vêm do motor de métricas
 * (mesmo caminho da tela de filiais, com o escopo de unidades da pessoa); a IA só escreve o texto em cima deste fato.
 * Indisponível nunca vira zero, moedas diferentes suspendem o ranking e filial fora do escopo não aparece.
 */
export class BranchRankingCapability implements CoreReadCapability {
  readonly descriptor = {
    id: "units.branch_ranking",
    displayName: "Ranking de filiais",
    description:
      "Ranking das filiais (maior, segunda, terceira e menor valor) em métricas de soma ou contagem do período corrente, como faturamento, caixa recebido, inadimplência ou leads. Use para perguntas sobre qual loja ou filial foi melhor, pior ou ficou em segundo ou terceiro.",
  } as const;

  constructor(
    private readonly comparison: Pick<UnitComparisonService, "compare">,
    /** Métricas liberadas para a empresa pelo pacote do setor. Sem isto, todas as do registro. */
    private readonly visibleMetricIds?: (tenantId: string) => Promise<ReadonlySet<string>>,
  ) {}

  async read(context: TenantContext, input: { productSlugs: readonly string[]; metricIds?: readonly string[] }): Promise<CoreReadCapabilityResult> {
    const unavailable: CoreReadCapabilityResult = { status: "unavailable", evidence: { kind: "source", ref: SOURCE_REF } };
    // O ranking é por filial na empresa toda; por produto não há leitura por filial, então não responde em vez de misturar.
    if (input.productSlugs.length > 0) return unavailable;

    const visible = this.visibleMetricIds ? await this.visibleMetricIds(context.tenantId).catch(() => null) : null;
    const allowed = (id: string) => rankable(id) && (visible === null || visible.has(id));
    const requested = [...new Set((input.metricIds ?? []).filter(allowed))].slice(0, MAX_RANKED_METRICS);
    const metricIds = requested.length > 0 ? requested : allowed(DEFAULT_RANKING_METRIC) ? [DEFAULT_RANKING_METRIC] : [];
    if (metricIds.length === 0) return unavailable;

    const views = await Promise.all(metricIds.map(async (metricId) => ({ metricId, view: await this.comparison.compare(context, { metricId }) })));
    const rankings = views.map(({ metricId, view }) => {
      const definition = METRIC_REGISTRY.find((m) => m.metricId === metricId)!;
      return {
        metricId, metricName: definition.displayName, unit: definition.unit,
        // Em custo e falha o MAIOR valor é o que preocupa: a polaridade vai junto para a resposta não chamar de "melhor" o maior custo.
        higherIsWorse: higherIsWorse(metricId),
        ...rankingHighlights(view.comparison),
      };
    });
    const withData = views.filter(({ view }) => view.source !== null);
    if (rankings.every((r) => r.status === "unavailable") || withData.length === 0) return unavailable;

    const sources = withData.map(({ view }) => view.source!);
    const order = ["fresh", "delayed", "unknown", "stale", "unavailable"];
    const qualityOrder = ["verified", "reconciled", "partial", "estimated", "unknown", "missing"];
    const pick = (values: readonly string[], ranking: readonly string[]) => values.reduce((a, b) => (ranking.indexOf(b) > ranking.indexOf(a) ? b : a));
    const starts = sources.flatMap((s) => (s.periodStart ? [s.periodStart.getTime()] : []));
    const ends = sources.flatMap((s) => (s.periodEnd ? [s.periodEnd.getTime()] : []));

    return {
      status: "available",
      fact: { capabilityId: this.descriptor.id, scope: "branches_visible_to_user", rankings },
      evidence: {
        kind: "source", ref: SOURCE_REF, sourceAuthority: "fmcc_metric_engine",
        freshnessStatus: pick(sources.map((s) => s.freshnessStatus), order),
        qualityStatus: pick(sources.map((s) => s.qualityStatus), qualityOrder),
        provenanceRefs: [...new Set(sources.flatMap((s) => s.provenanceRefs))],
        ...(starts.length ? { periodStart: new Date(Math.min(...starts)).toISOString() } : {}),
        ...(ends.length ? { periodEnd: new Date(Math.max(...ends)).toISOString() } : {}),
      },
    };
  }
}
