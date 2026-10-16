import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CoreQueryForm } from "@/app/dashboard/core-query-form";
import type { MetricView } from "@/application/metrics/metric-service";
import { temporalLabel } from "@/app/dashboard/metric-text";
import { createMetricService } from "@/application/metrics/metric-composition";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

const SUBSCRIPTION_METRICS = new Set([
  "subscription.active.count",
  "subscription.cancelled.count",
  "subscription.logo_churn.rate",
  "revenue.mrr",
  "revenue.arr",
  "receivable.delinquent_amount",
]);

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
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

  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const productsRepository = new PostgresProductRepository();
  const productService = new ProductRegistryService(productsRepository);
  const products = await productService.list(context);
  const requestedProductId = (await searchParams).productId?.trim();
  let selectedProduct = undefined;

  if (requestedProductId) {
    try {
      selectedProduct = await productService.get(context, requestedProductId);
    } catch {
      redirect("/dashboard/subscriptions");
    }
  }

  const overview = await createMetricService().overview(
    context,
    selectedProduct?.id,
  );
  const metrics = overview.filter(({ target }) =>
    SUBSCRIPTION_METRICS.has(target.metricId),
  );
  const representativeValue = metrics.find(({ value }) => value)?.value;
  const authority = representativeValue?.sourceAuthority;

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("subs.eyebrow")}</span>
          <h1>{t("subs.title")}</h1>
          <p>{t("subs.lead")}</p>
        </div>
        <Link href="/dashboard/finance">{t("subs.openFinance")}</Link>
      </header>

      <section className="panel" aria-labelledby="subscriptions-scope-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("metric.scopeEyebrow")}</span>
            <h2 id="subscriptions-scope-title">{t("metric.scopeTitle")}</h2>
          </div>
          <p>{t("subs.scopeNote")}</p>
        </div>
        <form action="/dashboard/subscriptions" method="get" className="command-quick-actions">
          <label htmlFor="subscriptions-product">{t("metric.product")}</label>
          <select
            id="subscriptions-product"
            name="productId"
            defaultValue={selectedProduct?.id ?? ""}
          >
            <option value="">{t("metric.allProducts")}</option>
            {products.map((product) => (
              <option value={product.id} key={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <button className="button" type="submit">{t("metric.apply")}</button>
        </form>
        <div className="foundation-grid">
          <article>
            <strong>{t("metric.product")}</strong>
            <span>{selectedProduct?.name ?? t("metric.consolidated")}</span>
          </article>
          <article>
            <strong>{t("metric.period")}</strong>
            <span>{temporalLabel(t, representativeValue)}</span>
          </article>
          <article>
            <strong>{t("metric.sourceLabel")}</strong>
            <span>
              {authority
                ? labels.sourceAuthority(authority)
                : t("metric.unavailableNotConnected")}
            </span>
          </article>
        </div>
      </section>

      <section className="metric-grid" aria-label={t("subs.metricsAria")}>
        <article className="metric-card">
          <span className="metric-label">{t("subs.newTitle")}</span>
          <strong>{t("common.unavailable")}</strong>
          <small>{t("subs.newNote")}</small>
        </article>
        {metrics.map(({ target, definition, value }) => (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{target.displayName}</span>
            <strong>
              {target.definitionStatus === "pending_semantics"
                ? t("common.pendingSemantics")
                : value?.value ?? t("common.unavailable")}
            </strong>
            <div className="metric-meta">
              <span>
                {value
                  ? t("home.metric.quality", { value: labels.quality(value.qualityStatus) })
                  : definition
                    ? t("metric.qualityUnavailable")
                    : t("cockpit.ruleNotApproved")}
              </span>
              <span>
                {value
                  ? t("home.metric.freshness", { value: labels.freshness(value.freshnessStatus) })
                  : t("metric.freshnessUnavailable")}
              </span>
              <span>{temporalLabel(t, value)}</span>
            </div>
            <small className="metric-provenance">
              {value
                ? t("metric.provenanceLine", { source: labels.sourceAuthority(value.sourceAuthority), provenance: value.provenanceRefs.join(" · ") || t("metric.provenanceNone") })
                : t("metric.noGovernedValue")}
            </small>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>{t("subs.separationTitle")}</h2>
        <p>{t("subs.separationText")}</p>
      </section>

      <CoreQueryForm
        productContext={
          selectedProduct
            ? { slug: selectedProduct.slug, name: selectedProduct.name }
            : undefined
        }
        domainContext={{
          label: selectedProduct
            ? t("subs.coreLabelScoped", { name: selectedProduct.name })
            : t("subs.coreLabel"),
          promptPrefix:
            "Responda no contexto governado do módulo Assinaturas do FM Command. Preserve as autoridades do Metric Registry e não confunda MRR, ARR, faturamento, caixa ou inadimplência.",
        }}
      />
    </main>
  );
}
