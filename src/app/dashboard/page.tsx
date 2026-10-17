import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildActivityFeedService } from "@/application/activity/activity-feed-composition";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
import { createMetricService, createUnitComparisonService } from "@/application/metrics/metric-composition";
import { OperationalHealthService } from "@/application/operations/operational-health-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { loadDashboardIdentity } from "@/application/security/dashboard-identity";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { BarChart } from "@/app/dashboard/charts/bar-chart";
import { DonutChart } from "@/app/dashboard/charts/donut-chart";
import { LineChart } from "@/app/dashboard/charts/line-chart";
import { lastClosedDelta, toTrendPoints } from "@/domain/metrics/series-view";
import { formatMonthKey } from "@/i18n/format";
import { buildBranchBars, formatBranchValue } from "@/app/dashboard/charts/branch-bars";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { PERIOD_KINDS, parsePeriodKind } from "@/domain/metrics/period";
import { EXECUTIVE_METRIC_TARGETS, METRIC_REGISTRY, getMetricDefinition } from "@/domain/metrics/registry";
import { roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresOperationalHealthRepository } from "@/infrastructure/operations/postgres-health-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { formatDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { CoreQueryForm } from "./core-query-form";
import { ProductComparisonForm } from "./product-comparison-form";
import { ProductCreateForm } from "./product-create-form";

type Translate = ReturnType<typeof createTranslator>["t"];

function formatTemporalContext(t: Translate, value: { periodStart?: Date; periodEnd?: Date; asOf?: Date }) {
  if (value.asOf) return t("home.temporal.asOf", { value: value.asOf.toISOString() });
  if (value.periodStart || value.periodEnd) return t("home.temporal.period", { start: value.periodStart?.toISOString() ?? "?", end: value.periodEnd?.toISOString() ?? "?" });
  return t("home.temporal.none");
}
function formatMetric(t: Translate, locale: Locale, value: string | null, unit: string, currency?: string) {
  if (value === null) return t("common.unavailable");
  if (unit === "currency" && currency) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(numeric); }
      catch { return `${value} ${currency}`; }
    }
  }
  return value;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const periodKind = parsePeriodKind((await searchParams).period);
  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const timeZone = await getCompanyTimeZone(context.tenantId);
  const healthLabel = (status: "operational" | "degraded" | "unavailable" | "unknown") => t(`home.health.${status}`);
  const metricService = createMetricService();
  const productsRepository = new PostgresProductRepository();
  const canReadActivity = roleHasPermission(context.role, "audit:read");
  const [metrics, products, alertOverview, operationalHealth, activityFeed, identity] = await Promise.all([
    metricService.overview(context, undefined, undefined, periodKind).catch((error) => {
      // Quem só enxerga unidades específicas não tem métrica do nível da empresa (ADR-019): os cartões abrem sem valor
      // próprio e, mais abaixo, recebem a soma das filiais que a pessoa enxerga.
      if (error instanceof PermissionDeniedError) return EXECUTIVE_METRIC_TARGETS.map((target) => ({ target, definition: getMetricDefinition(target.metricId), value: null }));
      throw error;
    }),
    new ProductRegistryService(productsRepository).list(context),
    buildAlertService().overview(context),
    new OperationalHealthService(
      new PostgresOperationalHealthRepository(),
      productsRepository,
    ).overview(context),
    canReadActivity
      ? buildActivityFeedService().page(context, { page: 1, pageSize: 6 })
      : Promise.resolve(null),
    loadDashboardIdentity(context).catch(() => null),
  ]);
  // Empresa com filiais: o cartão sem valor próprio da empresa mostra a soma das filiais (com a cobertura à vista). Valor próprio da empresa sempre vence.
  const needsConsolidation = metrics.filter((m) => m.definition && (!m.value || m.value.value === null)).map((m) => m.target.metricId);
  const consolidation = needsConsolidation.length
    ? await createUnitComparisonService().consolidate(context, { metricIds: needsConsolidation, periodKind }).catch(() => new Map())
    : new Map();
  // Gráfico das filiais que mais contribuem: só aparece se a empresa tem filiais no escopo da pessoa. Mesma métrica da tela Filiais (a primeira de soma visível).
  const noMetrics: ReadonlySet<string> = new Set();
  const visibleMetrics = await buildSectorService().visibleMetricIds(context.tenantId).catch(() => noMetrics);
  const rankingMetric = METRIC_REGISTRY.find((m) => visibleMetrics.has(m.metricId) && m.kind === "sum" && m.grain === "period") ?? METRIC_REGISTRY.find((m) => visibleMetrics.has(m.metricId) && m.kind === "sum");
  const branchView = rankingMetric
    ? await createUnitComparisonService().compare(context, { metricId: rankingMetric.metricId, periodKind }).catch(() => null)
    : null;
  const branchBars = branchView && rankingMetric && branchView.comparison.branches.length > 0 ? buildBranchBars(branchView.comparison, rankingMetric.unit, locale, 5) : null;
  const SERIES_MONTHS = 6;
  const monthlySeries = branchView && rankingMetric && branchView.comparison.branches.length > 0
    ? await createUnitComparisonService().monthlySeries(context, { metricId: rankingMetric.metricId, months: SERIES_MONTHS, timeZone }).catch(() => null)
    : null;
  const trendPoints = monthlySeries ? toTrendPoints(monthlySeries.points.map((p) => ({ key: p.key, closed: p.closed, total: p.comparison.total }))) : null;
  const trendDelta = trendPoints ? lastClosedDelta(trendPoints) : null;
  const lastClosed = trendPoints ? [...trendPoints].reverse().find((p) => p.closed) ?? null : null;
  const governedAvailable = metrics.filter(({ value, target }) => (value?.value !== null && value) || consolidation.get(target.metricId)?.total.status === "available").length;
  const activeProducts = products.filter((product) => product.status === "active").length;
  const activeAlerts = alertOverview.occurrences.filter((occurrence) => occurrence.status === "active").length;

  return (
    <main className="dashboard-shell dashboard-home-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("home.eyebrow")}</span>
          <h1>FM Command</h1>
          <p>{t("home.lead", { org: identity?.organizationName ?? t("home.leadFallbackOrg") })}</p>
        </div>
        <span className="dashboard-header-context">{identity?.organizationName ?? t("home.activeOrgFallback")}</span>
      </header>

      <section className="command-overview" aria-label={t("home.summaryAria")}>
        <article className={activeAlerts > 0 ? "command-card attention" : "command-card"}>
          <span>{t("home.card.attention")}</span>
          <strong>{activeAlerts}</strong>
          <small>{activeAlerts > 0 ? t("home.card.alertsActive") : t("home.card.alertsNone")}</small>
        </article>
        <article className="command-card">
          <span>{t("home.card.coverage")}</span>
          <strong>{governedAvailable}/{metrics.length}</strong>
          <small>{t("home.card.coverageNote")}</small>
        </article>
        <article className="command-card">
          <span>{t("home.card.products")}</span>
          <strong>{activeProducts}</strong>
          <small>{t("home.card.productsNote")}</small>
        </article>
        <article className="command-card">
          <span>{t("home.card.core")}</span>
          <strong>{t("home.card.coreValue")}</strong>
          <small><a href="#core-title">{t("home.card.coreLink")}</a></small>
        </article>
      </section>

      <section className="command-home-stage" aria-label={t("home.stageAria")}>
        <div className="command-home-main">
          <CoreQueryForm />
        </div>

        <aside className="command-home-rail" aria-label={t("home.railAria")}>
          <section className="panel command-rail-panel" aria-labelledby="dashboard-operational-health-title">
            <div className="command-rail-heading">
              <div>
                <span className="eyebrow">{t("home.ops.eyebrow")}</span>
                <h2 id="dashboard-operational-health-title">{t("home.ops.title")}</h2>
              </div>
              <Link href="/dashboard/operations">{t("common.seeAll")}</Link>
            </div>

            {operationalHealth.services.length ? (
              <>
                <div className="command-health-summary">
                  <div
                    className="command-health-ring"
                    aria-label={t("home.ops.ringAria", { ok: operationalHealth.counts.operational, total: operationalHealth.services.length })}
                  >
                    <strong>{operationalHealth.counts.operational}/{operationalHealth.services.length}</strong>
                    <span>{t("home.ops.ringLabel")}</span>
                  </div>
                  <div className="command-health-counts">
                    <span><strong>{operationalHealth.counts.degraded}</strong> {t("home.ops.degraded")}</span>
                    <span><strong>{operationalHealth.counts.unavailable}</strong> {t("home.ops.unavailable")}</span>
                    <span><strong>{operationalHealth.counts.unknown}</strong> {t("home.ops.unknown")}</span>
                  </div>
                </div>

                <ul className="command-service-list">
                  {operationalHealth.services.slice(0, 6).map(({ service, effectiveStatus }) => (
                    <li key={service.id}>
                      <div>
                        <strong>{service.name}</strong>
                        <small>{service.environment}</small>
                      </div>
                      <span className={`command-status-pill ${effectiveStatus}`}>
                        {healthLabel(effectiveStatus)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{t("home.ops.empty")}</p>
            )}
          </section>

          <section className="panel command-rail-panel" aria-labelledby="dashboard-alerts-title">
            <div className="command-rail-heading">
              <div>
                <span className="eyebrow">{t("home.alerts.eyebrow")}</span>
                <h2 id="dashboard-alerts-title">{t("home.alerts.title")}</h2>
              </div>
              <Link href="/dashboard/alerts">{t("common.seeAll")}</Link>
            </div>
            <div className={activeAlerts > 0 ? "command-alert-summary attention" : "command-alert-summary"}>
              <strong>{activeAlerts}</strong>
              <span>{activeAlerts === 1 ? t("home.alerts.one") : t("home.alerts.other")}</span>
            </div>
            {alertOverview.occurrences.length ? (
              <ul className="command-alert-list">
                {alertOverview.occurrences.slice(0, 4).map((occurrence) => (
                  <li key={occurrence.id}>
                    <span className={`command-alert-dot ${occurrence.severity}`} aria-hidden="true" />
                    <div>
                      <strong>{labels.metric(occurrence.metricId)}</strong>
                      <small>{labels.alertSeverity(occurrence.severity)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("home.alerts.empty")}</p>
            )}
          </section>
        </aside>
      </section>

      {activityFeed ? (
        <section className="panel command-activity-panel" aria-labelledby="dashboard-activity-title">
          <div className="command-rail-heading">
            <div>
              <span className="eyebrow">{t("home.activity.eyebrow")}</span>
              <h2 id="dashboard-activity-title">{t("home.activity.title")}</h2>
            </div>
            <Link href="/dashboard/activity">{t("home.activity.all")}</Link>
          </div>
          {activityFeed.items.length ? (
            <ul className="command-activity-grid">
              {activityFeed.items.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.category}</span>
                  <small>{formatDateTime(item.occurredAt, locale, timeZone)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("home.activity.empty")}</p>
          )}
        </section>
      ) : null}

      <section className="foundation-grid" aria-label={t("home.intel.aria")}>
        <Link href="/dashboard/finance"><strong>{t("home.intel.finance")}</strong><span>{t("home.intel.financeNote")}</span></Link>
        <Link href="/dashboard/growth"><strong>{t("home.intel.growth")}</strong><span>{t("home.intel.growthNote")}</span></Link>
        <Link href="/dashboard/operations"><strong>{t("home.intel.ops")}</strong><span>{t("home.intel.opsNote")}</span></Link>
        <Link href="/dashboard/customers"><strong>{t("home.intel.customers")}</strong><span>{t("home.intel.customersNote")}</span></Link>
        <Link href="/dashboard/intelligence"><strong>{t("home.intel.exec")}</strong><span>{t("home.intel.execNote")}</span></Link>
        <Link href="/dashboard/alerts"><strong>{t("home.intel.alerts")}</strong><span>{t("home.intel.alertsNote")}</span></Link>
        {roleHasPermission(context.role, "source:read") ? <Link href="/dashboard/sources"><strong>{t("home.intel.sources")}</strong><span>{t("home.intel.sourcesNote")}</span></Link> : null}
      </section>

      {branchView && rankingMetric && branchBars ? (
        <section className="executive-section" aria-labelledby="branch-ranking-title" data-testid="home-branch-ranking">
          <div className="section-heading">
            <div><span className="eyebrow">{t("home.branches.eyebrow")}</span><h2 id="branch-ranking-title">{t("home.branches.title", { metric: labels.metricName(rankingMetric.metricId, rankingMetric.displayName) })}</h2></div>
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
      ) : null}

      <section className="executive-section" aria-labelledby="executive-overview-title">
        <div className="section-heading">
          <div><span className="eyebrow">{t("home.overview.eyebrow")}</span><h2 id="executive-overview-title">{t("home.overview.title")}</h2></div>
          <p>{t("home.overview.note")}</p>
        </div>
        <form className="panel units-filter" method="get" action="/dashboard">
          <label>{t("units.filter.period")}
            <select name="period" defaultValue={periodKind}>
              {PERIOD_KINDS.map((k) => <option key={k} value={k}>{t(`units.period.${k}` as MessageKey)}</option>)}
            </select>
          </label>
          <button className="button primary" type="submit">{t("units.filter.apply")}</button>
        </form>
        <div className="metric-grid">
          {metrics.map(({ target, definition, value }) => {
            const consolidated = consolidation.get(target.metricId);
            const total = consolidated?.total.status === "available" ? consolidated.total : null;
            if (total && definition) {
              return (
                <article className="metric-card" key={target.metricId} data-consolidated="true">
                  <span className="metric-label">{labels.metricName(target.metricId, target.displayName)}</span>
                  <strong className="metric-value">{formatMetric(t, locale, total.value, definition.unit, total.currency)}</strong>
                  <div className="metric-meta">
                    <span>{t(consolidated?.fullCompany ? "home.metric.consolidated" : "home.metric.consolidatedScoped", { reporting: total.reporting, expected: total.expected })}</span>
                    {total.partial ? <span>{t("home.metric.consolidatedPartial")}</span> : null}
                  </div>
                  <small className="metric-provenance">{t("home.metric.consolidatedNote")}</small>
                </article>
              );
            }
            return (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{labels.metricName(target.metricId, target.displayName)}</span>
              <strong className={value?.value === null || !value ? "metric-value unavailable" : "metric-value"}>
                {value ? formatMetric(t, locale, value.value, value.unit, value.currency) : t("common.unavailable")}
              </strong>
              <div className="metric-meta">
                <span>{value ? t("home.metric.quality", { value: labels.quality(value.qualityStatus) }) : definition ? t("home.metric.noValue") : t("home.metric.pendingDefinition")}</span>
                <span>{value ? t("home.metric.freshness", { value: labels.freshness(value.freshnessStatus) }) : definition ? t("home.metric.notConnected") : t("home.metric.notImplemented")}</span>
                <span>{value ? formatTemporalContext(t, value) : t("home.metric.noPeriod")}</span>
              </div>
              <small className="metric-provenance">{value ? t("home.metric.source", { source: labels.sourceAuthority(value.sourceAuthority), version: value.metricVersion }) : t("home.metric.technicalId", { id: target.metricId, status: labels.definitionStatus(target.definitionStatus) })}</small>
            </article>
            );
          })}
        </div>
      </section>

      <section className="executive-section" aria-labelledby="product-intelligence-title">
        <div className="section-heading">
          <div><span className="eyebrow">{t("home.products.eyebrow")}</span><h2 id="product-intelligence-title">{t("home.products.title")}</h2></div>
          <p>{t("home.products.note")}</p>
        </div>
        {context.role === "owner" || context.role === "admin" ? <ProductCreateForm /> : null}
        {products.length ? (
          <div className="product-grid">
            {products.map((product) => (
              <Link className="product-card" key={product.id} href={`/dashboard/products/${product.id}`}>
                <span className="eyebrow">{labels.productStatus(product.status)}</span>
                <strong>{product.name}</strong>
                <small>{product.slug}</small>
              </Link>
            ))}
          </div>
        ) : <div className="empty-state"><strong>{t("home.products.emptyTitle")}</strong><p>{t("home.products.emptyText")}</p></div>}
      </section>

      {products.length >= 2 ? (
        <section className="executive-section" aria-labelledby="portfolio-comparison-title">
          <div className="section-heading">
            <div><span className="eyebrow">{t("home.compare.eyebrow")}</span><h2 id="portfolio-comparison-title">{t("home.compare.title")}</h2></div>
            <p>{t("home.compare.note")}</p>
          </div>
          <ProductComparisonForm products={products.map(({ id, name, slug }) => ({ id, name, slug }))} />
        </section>
      ) : null}

      <section className="foundation-grid" aria-label={t("home.platform.aria")}>
        <article><strong>{t("home.platform.identity")}</strong><span>{t("home.platform.identityNote")}</span></article>
        <article><strong>{t("home.platform.isolation")}</strong><span>{t("home.platform.isolationNote")}</span></article>
        <article><strong>{t("home.platform.metrics")}</strong><span>{t("home.platform.metricsNote")}</span></article>
        <article><strong>{t("home.platform.core")}</strong><span>{t("home.platform.coreNote")}</span></article>
      </section>

    </main>
  );
}
