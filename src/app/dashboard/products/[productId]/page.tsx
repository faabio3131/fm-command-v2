import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getRequestLocale } from "@/application/i18n/request-locale";
import type { MetricView } from "@/application/metrics/metric-service";
import { buildProductCockpitService } from "@/application/products/product-cockpit-composition";
import { ProductNotFoundError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import type { Locale } from "@/i18n/locales";
import { createTranslator } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { CoreQueryForm } from "../../core-query-form";

type Translate = ReturnType<typeof createTranslator>["t"];

function displayValue(t: Translate, locale: Locale, value: MetricView | null) {
  if (!value || value.value === null) return t("common.unavailable");
  if (value.unit === "currency" && value.currency) {
    const numeric = Number(value.value);
    if (Number.isFinite(numeric)) {
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: value.currency,
        }).format(numeric);
      } catch {
        return `${value.value} ${value.currency}`;
      }
    }
  }
  return value.value;
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (await companyLevelDenied(context)) return <NoCompanyAccess />;

  const { productId } = await params;
  let cockpit;
  try {
    cockpit = await buildProductCockpitService().overview(context, productId);
  } catch (error) {
    if (error instanceof ProductNotFoundError) notFound();
    throw error;
  }

  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const healthLabel = (status: "operational" | "degraded" | "unavailable" | "unknown") => t(`home.health.${status}`);
  const metricStateLabel = (status: "available" | "unavailable" | "pending_semantics", value: MetricView | null) =>
    status === "pending_semantics" ? t("cockpit.pendingSemantics") : displayValue(t, locale, value);
  const sourceStatusLabel = (status: "configured" | "healthy" | "degraded" | "unavailable") => t(`cockpit.source.${status}`);
  const hasHealth = cockpit.health.services.length > 0;
  const operatingResult = cockpit.finance.operatingResult;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("cockpit.eyebrow")}</span>
          <h1>{cockpit.product.name}</h1>
          <p>{t("cockpit.lead", { slug: cockpit.product.slug, status: labels.productStatus(cockpit.product.status) })}</p>
        </div>
        <div>
          <Link className="button" href="/dashboard">
            {t("cockpit.back")}
          </Link>
        </div>
      </header>

      <section className="metric-grid" aria-label={t("cockpit.summaryAria")}>
        <article className="metric-card">
          <span className="metric-label">{t("cockpit.coverage")}</span>
          <strong>
            {cockpit.coverage.available}/{cockpit.coverage.total}
          </strong>
          <small>{t("cockpit.coverageNote", { pending: cockpit.coverage.pendingSemantics, unavailable: cockpit.coverage.unavailable })}</small>
        </article>

        <article className="metric-card">
          <span className="metric-label">{t("cockpit.health")}</span>
          <strong>
            {hasHealth
              ? `${cockpit.health.counts.operational}/${cockpit.health.services.length}`
              : t("common.unavailable")}
          </strong>
          <small>
            {hasHealth
              ? t("cockpit.healthNote", { degraded: cockpit.health.counts.degraded, unavailable: cockpit.health.counts.unavailable, unknown: cockpit.health.counts.unknown })
              : t("cockpit.healthNone")}
          </small>
        </article>

        <article className="metric-card">
          <span className="metric-label">{t("cockpit.result")}</span>
          <strong>
            {operatingResult.status === "available"
              ? `${operatingResult.value} ${operatingResult.currency}`
              : t("common.unavailable")}
          </strong>
          <small>
            {operatingResult.status === "available"
              ? t("cockpit.resultDerived")
              : t("cockpit.resultNeeds")}
          </small>
        </article>

        <article className="metric-card">
          <span className="metric-label">{t("cockpit.alerts")}</span>
          <strong>{t("cockpit.alertsRules", { count: cockpit.alerts.counts.enabledRules })}</strong>
          <small>{t("cockpit.alertsNote", { active: cockpit.alerts.counts.recentActive, critical: cockpit.alerts.counts.recentCriticalActive })}</small>
        </article>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("cockpit.matrix.eyebrow")}</span>
            <h2>{t("cockpit.matrix.title")}</h2>
          </div>
          <p>{t("cockpit.matrix.note")}</p>
        </div>
        <div className="metric-grid">
          {cockpit.intelligence.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">
                {labels.productCategory(target.category)} · {target.displayName}
              </span>
              <strong
                className={
                  status === "available"
                    ? "metric-value"
                    : "metric-value unavailable"
                }
              >
                {metricStateLabel(status, value)}
              </strong>
              <div className="metric-meta">
                <span>
                  {value
                    ? t("cockpit.freshness", { value: labels.freshness(value.freshnessStatus) })
                    : t("cockpit.freshnessNone")}
                </span>
                <span>
                  {value
                    ? t("cockpit.quality", { value: labels.quality(value.qualityStatus) })
                    : t("cockpit.qualityNone")}
                </span>
              </div>
              <small className="metric-provenance">
                {value
                  ? t("cockpit.sourceRefs", { source: labels.sourceAuthority(value.sourceAuthority), count: value.provenanceRefs.length })
                  : t("cockpit.noProvenance")}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("cockpit.commercial.eyebrow")}</span>
            <h2>{t("cockpit.commercial.title")}</h2>
          </div>
          <p>{t("cockpit.commercial.note")}</p>
        </div>
        <div className="metric-grid">
          {cockpit.commercial.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{target.displayName}</span>
              <strong>{metricStateLabel(status, value)}</strong>
              <small>
                {value
                  ? t("cockpit.sourceFresh", { source: labels.sourceAuthority(value.sourceAuthority), fresh: labels.freshness(value.freshnessStatus) })
                  : status === "pending_semantics"
                    ? t("cockpit.ruleNotApproved")
                    : t("cockpit.notConnected")}
              </small>
            </article>
          ))}
        </div>
        <div className="panel">
          <p>{cockpit.commercial.funnel.reason}</p>
          <p>{cockpit.commercial.attribution.reason}</p>
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("cockpit.finance.eyebrow")}</span>
            <h2>{t("cockpit.finance.title")}</h2>
          </div>
          <p>{t("cockpit.finance.note")}</p>
        </div>
        <div className="metric-grid">
          {cockpit.finance.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{target.displayName}</span>
              <strong>{metricStateLabel(status, value)}</strong>
              <small>
                {value
                  ? t("cockpit.sourceQuality", { source: labels.sourceAuthority(value.sourceAuthority), quality: labels.quality(value.qualityStatus) })
                  : status === "pending_semantics"
                    ? t("cockpit.pendingSemantics")
                    : t("cockpit.notConnected")}
              </small>
            </article>
          ))}
        </div>
        <div className="foundation-grid">
          <article>
            <h3>{t("cockpit.unit.title")}</h3>
            <p>{t("cockpit.unit.text")}</p>
          </article>
          <article>
            <h3>{t("cockpit.billing.title")}</h3>
            <p>{t("cockpit.billing.text")}</p>
          </article>
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("cockpit.customers.eyebrow")}</span>
            <h2>{t("cockpit.customers.title")}</h2>
          </div>
          <p>{t("cockpit.customers.note")}</p>
        </div>
        <div className="metric-grid">
          {cockpit.customer.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{target.displayName}</span>
              <strong>{metricStateLabel(status, value)}</strong>
              <small>
                {value
                  ? t("cockpit.sourceOnly", { source: labels.sourceAuthority(value.sourceAuthority) })
                  : status === "pending_semantics"
                    ? t("cockpit.pendingSemantics")
                    : t("cockpit.notConnected")}
              </small>
            </article>
          ))}
        </div>
        <div className="panel">
          <p>{cockpit.customer.customerRisk.reason}</p>
          <p>{cockpit.customer.adoption.reason}</p>
          <p>{cockpit.customer.privacy.note}</p>
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("cockpit.ops.eyebrow")}</span>
            <h2>{t("cockpit.ops.title")}</h2>
          </div>
          <p>{cockpit.health.availability.reason}</p>
        </div>

        <div className="metric-grid">
          {cockpit.operations.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{target.displayName}</span>
              <strong>{metricStateLabel(status, value)}</strong>
              <small>
                {value
                  ? t("cockpit.sourceOnly", { source: labels.sourceAuthority(value.sourceAuthority) })
                  : status === "pending_semantics"
                    ? t("cockpit.pendingSemantics")
                    : t("cockpit.notConnected")}
              </small>
            </article>
          ))}
        </div>

        <div className="foundation-grid">
          {cockpit.health.services.length ? (
            cockpit.health.services.map(
              ({ service, observation, effectiveStatus }) => (
                <article key={service.id}>
                  <strong>{service.name}</strong>
                  <span>
                    {t("cockpit.ops.service", { environment: service.environment, status: healthLabel(effectiveStatus) })}
                  </span>
                  <p>
                    {observation
                      ? t("cockpit.ops.observation", { source: labels.sourceAuthority(observation.sourceAuthority), count: observation.provenanceRefs.length })
                      : t("cockpit.ops.noObservation")}
                  </p>
                </article>
              ),
            )
          ) : (
            <article>
              <strong>{t("cockpit.ops.noneTitle")}</strong>
              <p>{t("cockpit.ops.noneText")}</p>
            </article>
          )}
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("cockpit.integrations.eyebrow")}</span>
            <h2>{t("cockpit.integrations.title")}</h2>
          </div>
          <p>{cockpit.integrations.scopeNote}</p>
        </div>
        <div className="foundation-grid">
          {cockpit.integrations.items.length ? (
            cockpit.integrations.items.map((source) => (
              <article key={source.id}>
                <strong>{source.name}</strong>
                <span>
                  {t("cockpit.integrations.item", { domain: source.authoritativeDomain, status: sourceStatusLabel(source.status) })}
                </span>
                <p>{t("cockpit.integrations.detail", { type: source.sourceType, sync: source.syncMode, mapping: source.mappingVersion })}</p>
              </article>
            ))
          ) : (
            <article>
              <strong>{t("cockpit.integrations.noneTitle")}</strong>
              <p>{t("cockpit.integrations.noneText")}</p>
            </article>
          )}
        </div>
        {cockpit.integrations.sharedTenantSourceCount > 0 ? (
          <p>{t("cockpit.integrations.shared", { count: cockpit.integrations.sharedTenantSourceCount, name: cockpit.product.name })}</p>
        ) : null}
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("cockpit.alerts.eyebrow")}</span>
            <h2>{t("cockpit.alerts.title")}</h2>
          </div>
          <p>{cockpit.alerts.windowNote}</p>
        </div>
        <div className="foundation-grid">
          {cockpit.alerts.occurrences.length ? (
            cockpit.alerts.occurrences.slice(0, 8).map((occurrence) => (
              <article key={occurrence.id}>
                <strong>{labels.metric(occurrence.metricId)}</strong>
                <span>
                  {t("cockpit.alerts.state", { severity: labels.alertSeverity(occurrence.severity), status: labels.occurrenceState(occurrence.status) })}
                </span>
                <p>{t("cockpit.alerts.detail", { value: occurrence.observedValue, limit: `${labels.alertOperator(occurrence.operator)} ${occurrence.threshold}` })}</p>
              </article>
            ))
          ) : (
            <article>
              <strong>{t("cockpit.alerts.noneTitle")}</strong>
              <p>{t("cockpit.alerts.noneText")}</p>
            </article>
          )}
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("cockpit.growth.eyebrow")}</span>
            <h2>{t("cockpit.growth.title")}</h2>
          </div>
          <p>{t("cockpit.growth.note")}</p>
        </div>
        <div className="metric-grid">
          {cockpit.intelligence.growth.map((signal) => (
            <article className="metric-card" key={signal.metricId}>
              <span className="metric-label">{labels.metric(signal.metricId)}</span>
              <strong
                className={
                  signal.status === "available"
                    ? "metric-value"
                    : "metric-value unavailable"
                }
              >
                {signal.status === "available"
                  ? labels.growthDirection(signal.direction)
                  : t("common.unavailable")}
              </strong>
              <small>{t("cockpit.growth.noIndex")}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("cockpit.core.eyebrow")}</span>
            <h2>{t("cockpit.core.title")}</h2>
          </div>
          <p>{t("cockpit.core.note")}</p>
        </div>
        <CoreQueryForm
          productContext={{
            slug: cockpit.product.slug,
            name: cockpit.product.name,
          }}
        />
      </section>

      <section className="panel">
        <h2>{t("cockpit.gov.title")}</h2>
        <p>{t("cockpit.gov.p1")}</p>
        <p>{t("cockpit.gov.p2")}</p>
        <p>{t("cockpit.gov.p3")}</p>
      </section>
    </main>
  );
}
