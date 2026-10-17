import type { DimensionRankingService, DimensionRankingView } from "@/application/metrics/dimension-ranking-service";
import type { CoreReadCapability, CoreReadCapabilityResult } from "@/domain/core/read-capability";
import type { DimensionRankRow } from "@/domain/metrics/dimension-ranking";
import type { TenantContext } from "@/domain/security/tenant-context";

/** Métrica do ranking por produto: valor das linhas de pedidos faturados no mês corrente. */
export const PRODUCT_RANKING_METRIC = "sales.items.invoiced_amount";
const DIMENSION = "productRef";
const SOURCE_REF = "product-ranking";
/** Posições devolvidas à IA: com a 1ª, 2ª e 3ª ela responde "qual vendeu mais", "e o segundo"; o resto vira só contagem. */
const TOP = 5;

interface HighlightProduct {
  readonly productRef: string;
  readonly name: string;
  readonly value: string;
  readonly currency?: string;
  readonly sharePercent: string | null;
}
const toHighlight = (row: DimensionRankRow): HighlightProduct => ({
  productRef: row.key, name: row.label, value: row.value as string, ...(row.currency ? { currency: row.currency } : {}), sharePercent: row.sharePercent,
});

/**
 * "Qual produto vendeu mais, o segundo, o terceiro, o que menos vendeu?" Valores e posições vêm do motor de métricas
 * (as linhas dos pedidos faturados, só das filiais que a pessoa enxerga); a IA só escreve o texto em cima deste fato.
 * Indisponível nunca vira zero, moedas diferentes suspendem o ranking e linha sem código de produto é avisada, não adivinhada.
 */
export class ProductRankingCapability implements CoreReadCapability {
  readonly descriptor = {
    id: "sales.product_ranking",
    displayName: "Ranking de produtos mais vendidos",
    description:
      "Ranking dos produtos por valor faturado nos pedidos de venda do mês corrente (primeiro, segundo, terceiro e menos vendido), somando as filiais que a pessoa enxerga. Use para perguntas sobre qual produto vende mais ou menos, os mais vendidos ou os que não saem.",
  } as const;

  constructor(
    private readonly ranking: Pick<DimensionRankingService, "rank">,
    private readonly timeZone: (tenantId: string) => Promise<string>,
    /** Métricas liberadas para a empresa pelo pacote do setor. Sem isto, todas as do registro. */
    private readonly visibleMetricIds?: (tenantId: string) => Promise<ReadonlySet<string>>,
  ) {}

  async read(context: TenantContext, input: { productSlugs: readonly string[]; metricIds?: readonly string[] }): Promise<CoreReadCapabilityResult> {
    const unavailable: CoreReadCapabilityResult = { status: "unavailable", evidence: { kind: "source", ref: SOURCE_REF } };
    // "Produto" aqui é o item vendido do cliente; produto da plataforma (Kordena, NFCore) não tem linha de pedido.
    if (input.productSlugs.length > 0) return unavailable;
    const visible = this.visibleMetricIds ? await this.visibleMetricIds(context.tenantId).catch(() => null) : null;
    if (visible !== null && !visible.has(PRODUCT_RANKING_METRIC)) return unavailable;

    let view: DimensionRankingView;
    try {
      view = await this.ranking.rank(context, { metricId: PRODUCT_RANKING_METRIC, dimension: DIMENSION, timeZone: await this.timeZone(context.tenantId).catch(() => "UTC"), limit: 50 });
    } catch {
      return unavailable;
    }
    const { ranking } = view;
    if (ranking.rankingSuspended || view.rankedCount === 0 || !ranking.total) return unavailable;

    const ranked = ranking.rows.filter((row) => row.rank !== null && row.value !== null);
    const positions = ([1, 2, 3] as const)
      .map((position) => ({ position, products: ranked.filter((row) => row.rank === position).map(toHighlight) }))
      .filter((p) => p.products.length > 0);
    return {
      status: "available",
      fact: {
        capabilityId: this.descriptor.id, scope: "branches_visible_to_user", period: view.periodKind, metricId: PRODUCT_RANKING_METRIC,
        status: "available",
        positions,
        // Com um só produto, ou todos empatados, não há "menos vendido" distinto do mais vendido.
        lowest: view.lowest ? view.lowest.map(toHighlight) : null,
        top: ranked.slice(0, TOP).map((row) => ({ position: row.rank, ...toHighlight(row) })),
        total: ranking.total, productsRanked: view.rankedCount,
        productsWithoutValue: ranking.rows.filter((row) => row.value === null).map((row) => row.label),
        linesWithoutProduct: ranking.withoutDimension,
        coversWholeCompany: view.fullCompany,
      },
      evidence: {
        kind: "source", ref: SOURCE_REF, sourceAuthority: "fmcc_metric_engine",
        freshnessStatus: "unknown", qualityStatus: "unknown", provenanceRefs: ranking.provenanceRefs,
        periodStart: view.periodStart.toISOString(), periodEnd: view.periodEnd.toISOString(),
      },
    };
  }
}
