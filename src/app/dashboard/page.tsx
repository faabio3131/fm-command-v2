import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildActivityFeedService } from "@/application/activity/activity-feed-composition";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
import { createMetricService } from "@/application/metrics/metric-composition";
import { OperationalHealthService } from "@/application/operations/operational-health-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { loadDashboardIdentity } from "@/application/security/dashboard-identity";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresOperationalHealthRepository } from "@/infrastructure/operations/postgres-health-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { formatDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { createTranslator } from "@/i18n/translate";
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

export default async function DashboardPage() {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const timeZone = await getCompanyTimeZone(context.tenantId);
  const healthLabel = (status: "operational" | "degraded" | "unavailable" | "unknown") => t(`home.health.${status}`);
  const metricService = createMetricService();
  const productsRepository = new PostgresProductRepository();
  const canReadActivity = roleHasPermission(context.role, "audit:read");
  const [metrics, products, alertOverview, operationalHealth, activityFeed, identity] = await Promise.all([
    metricService.overview(context).catch((error) => {
      // Quem só enxerga unidades específicas não tem métrica do nível da empresa: o painel abre sem elas (ADR-019).
      if (error instanceof PermissionDeniedError) return [];
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
  const governedAvailable = metrics.filter(({ value }) => value?.value !== null && value).length;
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

      <section className="executive-section" aria-labelledby="executive-overview-title">
        <div className="section-heading">
          <div><span className="eyebrow">{t("home.overview.eyebrow")}</span><h2 id="executive-overview-title">{t("home.overview.title")}</h2></div>
          <p>{t("home.overview.note")}</p>
        </div>
        <div className="metric-grid">
          {metrics.map(({ target, definition, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{target.displayName}</span>
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
          ))}
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
