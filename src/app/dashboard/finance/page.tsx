import { BranchChartsSection } from "@/app/dashboard/charts/branch-charts-section";
import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import { createMetricService, createUnitComparisonService } from "@/application/metrics/metric-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
import { FINANCIAL_METRIC_TARGETS } from "@/domain/finance/intelligence";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator, type Translate } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

function displayValue(t: Translate, value: string | null, unit: string, currency?: string) {
  if (value === null) return t("common.unavailable");
  if (unit === "currency" && currency) return `${value} ${currency}`;
  return value;
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ metric?: string; period?: string }> }) {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (await companyLevelDenied(context)) return <NoCompanyAccess />;

  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const params = await searchParams;
  const timeZone = await getCompanyTimeZone(context.tenantId);
  const overview = await new FinancialIntelligenceService(
    createMetricService(),
    new PostgresProductRepository(),
  ).overview(context);

  // Empresa com filiais: o cartão sem valor próprio da empresa mostra a soma das filiais (mesma regra do painel inicial; valor próprio sempre vence).
  const needsConsolidation = overview.metrics.filter((m) => m.status === "unavailable").map((m) => m.target.metricId);
  const consolidation = needsConsolidation.length
    ? await createUnitComparisonService().consolidate(context, { metricIds: needsConsolidation }).catch(() => new Map())
    : new Map();

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("finance.eyebrow")}</span>
          <h1>{t("finance.title")}</h1>
          <p>{t("finance.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>

      <section className="metric-grid">
        {overview.metrics.map(({ target, status, value }) => {
          const consolidated = consolidation.get(target.metricId);
          const total = consolidated?.total.status === "available" ? consolidated.total : null;
          const definition = METRIC_REGISTRY.find((m) => m.metricId === target.metricId);
          if (total && definition) {
            return (
              <article className="metric-card" key={target.metricId} data-consolidated="true">
                <span className="metric-label">{labels.metricName(target.metricId, target.displayName)}</span>
                <strong>{displayValue(t, total.value, definition.unit, total.currency)}</strong>
                <small>{t(consolidated?.fullCompany ? "home.metric.consolidated" : "home.metric.consolidatedScoped", { reporting: total.reporting, expected: total.expected })}{total.partial ? ` · ${t("home.metric.consolidatedPartial")}` : ""}</small>
              </article>
            );
          }
          return (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{labels.metricName(target.metricId, target.displayName)}</span>
            <strong>{status === "pending_semantics" ? t("common.pendingSemantics") : value ? displayValue(t, value.value, value.unit, value.currency) : t("common.unavailable")}</strong>
            <small>{value ? t("common.sourceLine", { source: value.sourceAuthority }) : t("common.sourceNotConnected")}</small>
          </article>
          );
        })}
      </section>

      <BranchChartsSection context={context} action="/dashboard/finance" metricIds={FINANCIAL_METRIC_TARGETS.map((m) => m.metricId)} params={params} timeZone={timeZone} locale={locale} headingId="finance-branch-title" onlyCurrency />

      <section className="panel">
        <h2>{t("finance.result")}</h2>
        {overview.operatingResult.status === "available" ? (
          <p>
            <strong>{overview.operatingResult.value} {overview.operatingResult.currency}</strong>
            {" · "}
            {overview.operatingResult.direction === "profit" ? t("finance.profit") : overview.operatingResult.direction === "loss" ? t("finance.loss") : t("finance.even")}
          </p>
        ) : (
          <p>{t("finance.resultNone")}</p>
        )}
      </section>

      <section className="panel">
        <h2>{t("finance.unit")}</h2>
        <p>{t("finance.unitText")}</p>
      </section>
    </main>
  );
}
