import { BranchChartsSection } from "@/app/dashboard/charts/branch-charts-section";
import { ConsolidatedMetricCard } from "@/app/dashboard/charts/consolidated-card";
import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createMetricService, createUnitComparisonService } from "@/application/metrics/metric-composition";
import { OperationalHealthService } from "@/application/operations/operational-health-service";
import { OperationsIntelligenceService } from "@/application/operations/operations-intelligence-service";
import { getMetricDefinition } from "@/domain/metrics/registry";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
import { OPERATIONS_METRIC_TARGETS } from "@/domain/operations/intelligence";

import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresOperationalHealthRepository } from "@/infrastructure/operations/postgres-health-repository";
import { createTranslator } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ metric?: string; period?: string }> }) {
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

  const params = await searchParams;
  const timeZone = await getCompanyTimeZone(context.tenantId);
  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const statusLabel = (status: "operational" | "degraded" | "unavailable" | "unknown") => t(`home.health.${status}`);
  const hasMonitoredServices = health.services.length > 0;

  // Empresa com filiais: o cartão sem valor próprio mostra a soma das filiais (mesma regra do painel inicial; valor próprio sempre vence).
  const needsConsolidation = overview.metrics.filter((m) => m.status === "unavailable").map((m) => m.target.metricId);
  const consolidation = needsConsolidation.length
    ? await createUnitComparisonService().consolidate(context, { metricIds: needsConsolidation }).catch(() => new Map())
    : new Map();

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
        {overview.metrics.map(({ target, status, value }) => {
          const consolidated = consolidation.get(target.metricId);
          const definition = getMetricDefinition(target.metricId);
          if (consolidated && definition) return <ConsolidatedMetricCard key={target.metricId} metricName={labels.metricName(target.metricId, target.displayName)} unit={definition.unit} consolidation={consolidated} locale={locale} />;
          return (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{labels.metricName(target.metricId, target.displayName)}</span>
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
          );
        })}
      </section>

      <BranchChartsSection context={context} action="/dashboard/operations" metricIds={OPERATIONS_METRIC_TARGETS.map((m) => m.metricId)} params={params} timeZone={timeZone} locale={locale} headingId="operations-branch-title" />

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
