import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { createLabels } from "@/presentation/labels";
import { AlertControlPanel } from "./alert-control-panel";

export default async function AlertsPage() {
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
  const [overview, products] = await Promise.all([
    buildAlertService().overview(context),
    new ProductRegistryService(new PostgresProductRepository()).list(context),
  ]);

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("alerts.eyebrow")}</span>
          <h1>{t("alerts.title")}</h1>
          <p>{t("alerts.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>

      <section className="guardrail-grid" aria-label={t("alerts.guardAria")}>
        <article><span className="eyebrow">{t("alerts.g1.eyebrow")}</span><strong>{t("alerts.g1.title")}</strong><p>{t("alerts.g1.text")}</p></article>
        <article><span className="eyebrow">{t("alerts.g2.eyebrow")}</span><strong>{t("alerts.g2.title")}</strong><p>{t("alerts.g2.text")}</p></article>
        <article><span className="eyebrow">{t("alerts.g3.eyebrow")}</span><strong>{t("alerts.g3.title")}</strong><p>{t("alerts.g3.text")}</p></article>
        <article><span className="eyebrow">{t("alerts.g4.eyebrow")}</span><strong>{t("alerts.g4.title")}</strong><p>{t("alerts.g4.text")}</p></article>
      </section>

      <AlertControlPanel
        rules={overview.rules}
        occurrences={overview.occurrences}
        products={products.map(({ id, name }) => ({ id, name }))}
        metrics={METRIC_REGISTRY.map(({ metricId, displayName }) => ({ metricId, displayName: labels.metricName(metricId, displayName) }))}
        canWrite={roleHasPermission(context.role, "alert:write")}
        canPrepare={roleHasPermission(context.role, "action:prepare")}
      />
    </main>
  );
}
