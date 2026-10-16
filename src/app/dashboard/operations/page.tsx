import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createMetricService } from "@/application/metrics/metric-composition";
import { OperationalHealthService } from "@/application/operations/operational-health-service";
import { OperationsIntelligenceService } from "@/application/operations/operations-intelligence-service";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresOperationalHealthRepository } from "@/infrastructure/operations/postgres-health-repository";
import { createTranslator } from "@/i18n/translate";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export default async function OperationsPage() {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (await companyLevelDenied(context)) return <NoCompanyAccess />;

  const products = new PostgresProductRepository();
  const [overview, health] = await Promise.all([
    new OperationsIntelligenceService(
      createMetricService(),
      products,
    ).overview(context),
    new OperationalHealthService(
      new PostgresOperationalHealthRepository(),
      products,
    ).overview(context),
  ]);

  const { t } = createTranslator(await getRequestLocale());
  const statusLabel = (status: "operational" | "degraded" | "unavailable" | "unknown") => t(`home.health.${status}`);
  const hasMonitoredServices = health.services.length > 0;

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("ops.eyebrow")}</span>
          <h1>{t("ops.title")}</h1>
          <p>{t("ops.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>

      <section className="metric-grid" aria-label={t("ops.summaryAria")}>
        <article className="metric-card">
          <span className="metric-label">{t("ops.monitored")}</span>
          <strong>{hasMonitoredServices ? health.services.length : t("common.unavailable")}</strong>
          <small>{hasMonitoredServices ? t("ops.monitoredNote") : t("ops.monitoredNone")}</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">{t("ops.operational")}</span>
          <strong>{hasMonitoredServices ? health.counts.operational : t("common.unavailable")}</strong>
          <small>{t("ops.operationalNote")}</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">{t("ops.degraded")}</span>
          <strong>{hasMonitoredServices ? health.counts.degraded : t("common.unavailable")}</strong>
          <small>{t("ops.degradedNote")}</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">{t("ops.unavailable")}</span>
          <strong>
            {hasMonitoredServices
              ? health.counts.unavailable + health.counts.unknown
              : t("common.unavailable")}
          </strong>
          <small>{t("ops.unavailableNote")}</small>
        </article>
      </section>

      <section className="panel" aria-labelledby="service-health-title">
        <h2 id="service-health-title">{t("ops.services")}</h2>
        <p>{health.availability.reason}</p>
        {health.services.length ? (
          <div className="foundation-grid">
            {health.services.map(({ service, observation, effectiveStatus }) => (
              <article key={service.id}>
                <strong>{service.name}</strong>
                <span>{service.environment} · {statusLabel(effectiveStatus)}</span>
                <small>
                  {observation
                    ? t("ops.observation", { source: observation.sourceAuthority, freshness: observation.freshnessStatus, at: observation.observedAt.toISOString() })
                    : t("ops.noObservation")}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>{t("ops.noneTitle")}</strong>
            <p>{t("ops.noneText")}</p>
          </div>
        )}
      </section>

      <section className="metric-grid">
        {overview.metrics.map(({ target, status, value }) => (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{target.displayName}</span>
            <strong>
              {status === "pending_semantics"
                ? t("common.pendingSemantics")
                : value?.value ?? t("common.unavailable")}
            </strong>
            <small>
              {value
                ? t("common.sourceLine", { source: value.sourceAuthority })
                : status === "pending_semantics"
                  ? t("common.ruleNotApprovedShort")
                  : t("ops.telemetry")}
            </small>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>{t("ops.runtime")}</h2>
        <p>{t("ops.runtimeText", { health: overview.runtime.healthEndpoint, ready: overview.runtime.readinessEndpoint })}</p>
        <p>{overview.availability.reason}</p>
      </section>

      <section className="panel">
        <h2>{t("ops.signals")}</h2>
        <p>{overview.alerts.reason}</p>
      </section>
    </main>
  );
}
