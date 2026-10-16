import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CustomerIntelligenceService } from "@/application/customer/customer-intelligence-service";
import { createMetricService } from "@/application/metrics/metric-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export default async function CustomersPage() {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (await companyLevelDenied(context)) return <NoCompanyAccess />;

  const { t } = createTranslator(await getRequestLocale());
  const overview = await new CustomerIntelligenceService(
    createMetricService(),
    new PostgresProductRepository(),
  ).overview(context);

  return (
    <main className="dashboard-shell dashboard-shell-compact customers-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("customers.eyebrow")}</span>
          <h1>{t("customers.title")}</h1>
          <p>{t("customers.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>

      <section className="metric-grid">
        {overview.metrics.map(({ target, status, value }) => (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{target.displayName}</span>
            <strong>{status === "pending_semantics" ? t("common.pendingSemantics") : value?.value ?? t("common.unavailable")}</strong>
            <small>{value ? t("common.sourceLine", { source: value.sourceAuthority }) : status === "pending_semantics" ? t("common.ruleNotApprovedShort") : t("common.sourceNotConnected")}</small>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>{t("customers.signals")}</h2>
        {overview.factualSignals.length ? (
          <ul>
            {overview.factualSignals.map((signal) => (
              <li key={signal.metricId}><strong>{signal.displayName}:</strong> {signal.value ?? t("common.unavailable")}</li>
            ))}
          </ul>
        ) : <p>{t("customers.signalsNone")}</p>}
      </section>

      <section className="panel">
        <h2>{t("customers.risk")}</h2>
        <p>{overview.customerRisk.reason}</p>
        <p>{overview.adoption.reason}</p>
        <p>{overview.privacy.note}</p>
      </section>
    </main>
  );
}
