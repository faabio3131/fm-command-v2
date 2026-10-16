import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ExecutiveAnalysisService } from "@/application/executive/executive-analysis-service";
import { createMetricService } from "@/application/metrics/metric-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator, type Translate } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { CoreQueryForm } from "../core-query-form";

function formatValue(t: Translate, value: string | null, unit: string, currency?: string) {
  if (value === null) return t("common.unavailable");
  return unit === "currency" && currency ? `${value} ${currency}` : value;
}

export default async function IntelligencePage() {
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
  const overview = await new ExecutiveAnalysisService(
    createMetricService(),
    new PostgresProductRepository(),
  ).overview(context);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("intel.eyebrow")}</span>
          <h1>{t("intel.title")}</h1>
          <p>{t("intel.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>

      <section className="executive-section">
        <div className="section-heading">
          <div><span className="eyebrow">{t("intel.evidence")}</span><h2>{t("intel.signals")}</h2></div>
          <p>{t("intel.signalsNote")}</p>
        </div>
        <div className="metric-grid">
          {overview.signals.map((signal) => (
            <article className="metric-card" key={signal.metricId}>
              <span className="metric-label">{labels.metricName(signal.metricId, signal.displayName)}</span>
              <strong>{signal.value ? formatValue(t, signal.value.value, signal.value.unit, signal.value.currency) : t("common.unavailable")}</strong>
              <small>{signal.status === "available" ? t("intel.fact") : t("intel.noData")}</small>
              <small>
                {t("intel.variation", {
                  value:
                    signal.variation.status === "available"
                      ? t("intel.variationValue", { direction: signal.variation.direction ?? "", delta: signal.variation.delta ?? "" })
                      : t("intel.variationNone"),
                })}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="guardrail-grid" aria-label={t("intel.guardrailsAria")}>
        <article><span className="eyebrow">{t("intel.correlation")}</span><strong>{overview.correlation.status === "evidence_ready" ? t("intel.evidenceReady") : t("intel.evidenceLacking")}</strong><p>{overview.correlation.note}</p></article>
        <article><span className="eyebrow">{t("intel.anomaly")}</span><strong>{t("intel.evidenceLacking")}</strong><p>{overview.anomaly.reason}</p></article>
        <article><span className="eyebrow">{t("intel.risk")}</span><strong>{t("intel.evidenceLacking")}</strong><p>{overview.risk.reason}</p></article>
        <article><span className="eyebrow">{t("intel.forecast")}</span><strong>{t("intel.evidenceLacking")}</strong><p>{overview.forecast.reason}</p></article>
      </section>

      <CoreQueryForm />
    </main>
  );
}
