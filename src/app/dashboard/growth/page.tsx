import { BranchChartsSection } from "@/app/dashboard/charts/branch-charts-section";
import { ConsolidatedMetricCard } from "@/app/dashboard/charts/consolidated-card";
import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GrowthIntelligenceService } from "@/application/growth/growth-intelligence-service";
import { createMetricService, createUnitComparisonService } from "@/application/metrics/metric-composition";
import { getMetricDefinition } from "@/domain/metrics/registry";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
import { GROWTH_METRIC_TARGETS } from "@/domain/growth/intelligence";

import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ metric?: string; period?: string }> }) {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (await companyLevelDenied(context)) return <NoCompanyAccess />;

  const params = await searchParams;
  const timeZone = await getCompanyTimeZone(context.tenantId);
  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const overview = await new GrowthIntelligenceService(
    createMetricService(),
    new PostgresProductRepository(),
  ).overview(context);

  // Empresa com filiais: o cartão sem valor próprio mostra a soma das filiais (mesma regra do painel inicial; valor próprio sempre vence).
  const needsConsolidation = overview.metrics.filter((m) => m.status === "unavailable").map((m) => m.target.metricId);
  const consolidation = needsConsolidation.length
    ? await createUnitComparisonService().consolidate(context, { metricIds: needsConsolidation }).catch(() => new Map())
    : new Map();

  return (
    <main className="dashboard-shell dashboard-shell-compact growth-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("growth.eyebrow")}</span>
          <h1>{t("growth.title")}</h1>
          <p>{t("growth.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>

      <section className="metric-grid">
        {overview.metrics.map(({ target, status, value }) => {
          const consolidated = consolidation.get(target.metricId);
          const definition = getMetricDefinition(target.metricId);
          if (consolidated && definition) return <ConsolidatedMetricCard key={target.metricId} metricName={labels.metricName(target.metricId, target.displayName)} unit={definition.unit} consolidation={consolidated} locale={locale} />;
          return (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{labels.metricName(target.metricId, target.displayName)}</span>
            <strong>{status === "pending_semantics" ? t("common.pendingSemantics") : value?.value ?? t("common.unavailable")}</strong>
            <small>{value ? t("common.sourceLine", { source: value.sourceAuthority }) : status === "pending_semantics" ? t("common.ruleNotApprovedShort") : t("common.sourceNotConnected")}</small>
          </article>
          );
        })}
      </section>

      <BranchChartsSection context={context} action="/dashboard/growth" metricIds={GROWTH_METRIC_TARGETS.map((m) => m.metricId)} params={params} timeZone={timeZone} locale={locale} headingId="growth-branch-title" />

      <section className="panel">
        <h2>{t("growth.attribution")}</h2>
        <p>{overview.attribution.reason}</p>
        <p>{overview.funnel.reason}</p>
      </section>
    </main>
  );
}
