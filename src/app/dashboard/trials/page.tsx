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

const TRIAL_METRICS = new Set([
  "trial.starts.count",
  "trial.active.count",
  "trial.conversion.rate",
]);

export default async function TrialsPage({
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
      redirect("/dashboard/trials");
    }
  }

  const overview = await createMetricService().overview(
    context,
    selectedProduct?.id,
  );
  const metrics = overview.filter(({ target }) =>
    TRIAL_METRICS.has(target.metricId),
  );
  const started = metrics.find(
    ({ target }) => target.metricId === "trial.starts.count",
  )?.value;
  const authority = metrics.find(({ value }) => value?.sourceAuthority)?.value
    ?.sourceAuthority;

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("trials.eyebrow")}</span>
          <h1>{t("trials.title")}</h1>
          <p>{t("trials.lead")}</p>
        </div>
        <Link href="/dashboard/growth">{t("trials.openGrowth")}</Link>
      </header>

      <section className="panel" aria-labelledby="trials-scope-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("metric.scopeEyebrow")}</span>
            <h2 id="trials-scope-title">{t("metric.scopeTitle")}</h2>
          </div>
          <p>{t("trials.scopeNote")}</p>
        </div>
        <form action="/dashboard/trials" method="get" className="command-quick-actions">
          <label htmlFor="trials-product">{t("metric.product")}</label>
          <select id="trials-product" name="productId" defaultValue={selectedProduct?.id ?? ""}>
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
            <span>{temporalLabel(t, started)}</span>
          </article>
          <article>
            <strong>{t("trials.origin")}</strong>
            <span>
              {authority
                ? labels.sourceAuthority(authority)
                : t("metric.unavailableNotConnected")}
            </span>
          </article>
          <article>
            <strong>{t("trials.cohort")}</strong>
            <span>{t("trials.cohortNote")}</span>
          </article>
        </div>
      </section>

      <section className="metric-grid" aria-label={t("trials.metricsAria")}>
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
        <article className="metric-card">
          <span className="metric-label">{t("trials.endedTitle")}</span>
          <strong>{t("common.unavailable")}</strong>
          <small>{t("trials.endedNote")}</small>
        </article>
      </section>

      <section className="panel">
        <h2>{t("trials.conversionTitle")}</h2>
        <p>{t("trials.conversionText")}</p>
      </section>

      <CoreQueryForm
        productContext={
          selectedProduct
            ? { slug: selectedProduct.slug, name: selectedProduct.name }
            : undefined
        }
        domainContext={{
          label: selectedProduct ? t("trials.coreLabelScoped", { name: selectedProduct.name }) : t("trials.coreLabel"),
          promptPrefix:
            "Responda no contexto governado do módulo Trials do FM Command. Preserve as autoridades do Metric Registry e trate dados ausentes como indisponíveis.",
        }}
      />
    </main>
  );
}
