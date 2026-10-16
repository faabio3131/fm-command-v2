import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import { createMetricService } from "@/application/metrics/metric-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
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

export default async function FinancePage() {
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
  const overview = await new FinancialIntelligenceService(
    createMetricService(),
    new PostgresProductRepository(),
  ).overview(context);

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
        {overview.metrics.map(({ target, status, value }) => (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{labels.metricName(target.metricId, target.displayName)}</span>
            <strong>{status === "pending_semantics" ? t("common.pendingSemantics") : value ? displayValue(t, value.value, value.unit, value.currency) : t("common.unavailable")}</strong>
            <small>{value ? t("common.sourceLine", { source: value.sourceAuthority }) : t("common.sourceNotConnected")}</small>
          </article>
        ))}
      </section>

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
