import { createDimensionRankingService } from "@/application/metrics/metric-composition";
import { barWidthPercent, compareDecimals, parseDecimal } from "@/domain/core/decimal";
import type { PeriodKind } from "@/domain/metrics/period";
import type { TenantContext } from "@/domain/security/tenant-context";
import type { Locale } from "@/i18n/locales";
import { createTranslator } from "@/i18n/translate";
import { BarChart, type BarChartItem } from "./bar-chart";
import { formatBranchValue } from "./branch-bars";

const METRIC_ID = "sales.items.invoiced_amount";
const TOP = 5;

/**
 * Produtos mais vendidos: as linhas dos pedidos faturados no período, somadas nas filiais que a pessoa enxerga.
 * Tudo vem do motor de métricas (mesma regra do Core). Some se não há produto com valor; produto sem valor nunca vira zero,
 * linha sem código de produto fica de fora e é avisada, e moedas diferentes suspendem o ranking.
 */
export async function ProductRanking({ context, periodKind, timeZone, locale }: { context: TenantContext; periodKind: PeriodKind; timeZone: string; locale: Locale }) {
  const view = await createDimensionRankingService().rank(context, { metricId: METRIC_ID, dimension: "productRef", periodKind, timeZone, limit: TOP }).catch(() => null);
  if (!view || view.rankedCount === 0) return null;
  const { t } = createTranslator(locale);
  const { ranking } = view;
  const shown = ranking.rows.filter((row) => row.rank !== null && row.value !== null);
  const max = shown.map((row) => parseDecimal(row.value)).filter((v) => v !== null).sort((a, b) => compareDecimals(b, a))[0];
  const items: BarChartItem[] = shown.map((row) => ({
    id: row.key, label: row.label, valueText: formatBranchValue(row.value as string, "currency", row.currency, locale),
    widthPercent: !max || ranking.rankingSuspended ? "0" : barWidthPercent(parseDecimal(row.value)!, max),
  }));
  const hidden = view.rankedCount - shown.length;

  return (
    <section className="executive-section" aria-labelledby="product-ranking-title" data-testid="home-product-ranking">
      <div className="section-heading">
        <div><span className="eyebrow">{t("home.topProducts.eyebrow")}</span><h2 id="product-ranking-title">{t("home.topProducts.title")}</h2></div>
        <p>{t("home.topProducts.note")}</p>
      </div>
      <div className="insight-grid">
        <article className="insight-card">
          <h3>{t("home.topProducts.top", { count: TOP })}</h3>
          {ranking.rankingSuspended ? <p>{t("units.rankingSuspended")}</p> : <BarChart items={items} ariaLabel={t("home.topProducts.aria")} unavailableText={t("common.unavailable")} />}
          <p className="metric-provenance">
            {t("home.topProducts.coverage", { ranked: view.rankedCount })}
            {hidden > 0 ? ` · ${t("home.topProducts.hidden", { count: hidden })}` : ""}
            {ranking.withoutDimension > 0 ? ` · ${t("home.topProducts.withoutProduct", { count: ranking.withoutDimension })}` : ""}
            {!view.fullCompany ? ` · ${t("home.topProducts.partialScope")}` : ""}
          </p>
        </article>
      </div>
    </section>
  );
}
