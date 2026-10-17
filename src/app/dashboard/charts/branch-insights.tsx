import Link from "next/link";
import { createUnitComparisonService } from "@/application/metrics/metric-composition";
import type { MetricDefinition } from "@/domain/metrics/registry";
import { lastClosedDelta, toTrendPoints } from "@/domain/metrics/series-view";
import type { PeriodKind } from "@/domain/metrics/period";
import type { TenantContext } from "@/domain/security/tenant-context";
import { formatMonthKey } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { createTranslator } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { BarChart } from "./bar-chart";
import { buildBranchBars, formatBranchValue } from "./branch-bars";
import { DonutChart } from "./donut-chart";
import { LineChart } from "./line-chart";

const SERIES_MONTHS = 6;

/**
 * Bloco de gráficos por filial para UMA métrica: tendência mensal com variação, participação e maiores contribuições.
 * Reusado pelas telas do painel (cada uma passa a métrica dela). Some se a empresa não tem filiais no escopo da pessoa.
 * Tudo vem do motor de métricas; "indisponível" nunca vira zero.
 */
export async function BranchInsights({ context, definition: rankingMetric, periodKind, timeZone, locale, headingId = "branch-ranking-title" }: {
  context: TenantContext; definition: MetricDefinition; periodKind: PeriodKind; timeZone: string; locale: Locale; headingId?: string;
}) {
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const service = createUnitComparisonService();
  const branchView = await service.compare(context, { metricId: rankingMetric.metricId, periodKind }).catch(() => null);
  if (!branchView || branchView.comparison.branches.length === 0) return null;
  const branchBars = buildBranchBars(branchView.comparison, rankingMetric.unit, locale, 5);
  const monthlySeries = await service.monthlySeries(context, { metricId: rankingMetric.metricId, months: SERIES_MONTHS, timeZone }).catch(() => null);
  const trendPoints = monthlySeries ? toTrendPoints(monthlySeries.points.map((p) => ({ key: p.key, closed: p.closed, total: p.comparison.total }))) : null;
  const trendDelta = trendPoints ? lastClosedDelta(trendPoints) : null;
  const lastClosed = trendPoints ? [...trendPoints].reverse().find((p) => p.closed) ?? null : null;

  return (
    <section className="executive-section" aria-labelledby={headingId} data-testid="home-branch-ranking">
      <div className="section-heading">
        <div><span className="eyebrow">{t("home.branches.eyebrow")}</span><h2 id={headingId}>{t("home.branches.title", { metric: labels.metricName(rankingMetric.metricId, rankingMetric.displayName) })}</h2></div>
        <p>{t("home.branches.note")}</p>
      </div>
      <div className="insight-grid">
        {trendPoints ? (
          <article className="insight-card" data-testid="home-trend">
            <h3>{t("home.trend.title")}</h3>
            <div className="insight-figure">
              <strong>{lastClosed?.value ? formatBranchValue(lastClosed.value, rankingMetric.unit, lastClosed.currency, locale) : t("common.unavailable")}</strong>
              {trendDelta?.status === "available" ? (
                <span className="delta" data-direction={trendDelta.direction}>
                  <span aria-hidden="true">{trendDelta.direction === "up" ? "▲" : trendDelta.direction === "down" ? "▼" : "■"}</span>
                  {t("home.trend.delta", { percent: `${trendDelta.direction === "up" ? "+" : ""}${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(trendDelta.percent as unknown as number)}`, month: formatMonthKey(trendDelta.fromKey, locale) })}
                </span>
              ) : <span className="delta" data-direction="none">{t("home.trend.deltaUnavailable")}</span>}
            </div>
            <p className="metric-provenance">{lastClosed ? t("home.trend.lastClosed", { month: formatMonthKey(lastClosed.key, locale) }) : t("home.trend.noClosed")}</p>
            <LineChart points={trendPoints} ariaLabel={t("home.trend.aria", { metric: labels.metricName(rankingMetric.metricId, rankingMetric.displayName), months: SERIES_MONTHS })}
              monthLabel={(key) => formatMonthKey(key, locale, false)} formatValue={(value, currency) => formatBranchValue(value, rankingMetric.unit, currency, locale)}
              unavailableText={t("common.unavailable")} openMonthText={t("home.trend.openMonth")} />
            <p className="metric-provenance">{t("home.trend.note")}</p>
          </article>
        ) : null}
        <article className="insight-card" data-testid="home-share">
          <h3>{t("home.share.title")}</h3>
          {branchView.comparison.rankingSuspended ? (
            <p>{t("units.rankingSuspended")}</p>
          ) : (
            <DonutChart items={branchView.comparison.branches.map((b) => ({ id: b.unitId, label: b.name, valueText: b.value === null ? null : formatBranchValue(b.value, rankingMetric.unit, b.currency, locale), sharePercent: b.sharePercent }))}
              ariaLabel={t("home.share.aria", { metric: labels.metricName(rankingMetric.metricId, rankingMetric.displayName) })} unavailableText={t("common.unavailable")} othersLabel={(count) => t("home.share.others", { count })} formatPercent={(percent) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(percent as unknown as number)}%`} />
          )}
        </article>
        <article className="insight-card">
          <h3>{t("home.branches.top")}</h3>
          {branchView.comparison.rankingSuspended ? (
            <p>{t("units.rankingSuspended")}</p>
          ) : branchBars.items.length ? (
            <BarChart items={branchBars.items} ariaLabel={t("home.branches.aria", { metric: labels.metricName(rankingMetric.metricId, rankingMetric.displayName) })} unavailableText={t("common.unavailable")} />
          ) : (
            <p>{t("units.total.reason.no_data")}</p>
          )}
          <p className="metric-provenance">
            {t("home.branches.coverage", { reporting: branchView.comparison.branches.length - branchBars.unavailableCount, expected: branchView.comparison.branches.length })}
            {branchBars.unavailableCount > 0 ? ` · ${t("home.branches.missing", { count: branchBars.unavailableCount })}` : ""}
            {branchBars.hiddenCount > 0 ? ` · ${t("home.branches.hidden", { count: branchBars.hiddenCount })}` : ""}
          </p>
          <Link href={`/dashboard/units?metric=${encodeURIComponent(rankingMetric.metricId)}&period=${periodKind}`}>{t("home.branches.all")}</Link>
        </article>
      </div>
    </section>

  );
}
