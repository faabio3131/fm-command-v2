import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CoreQueryForm } from "@/app/dashboard/core-query-form";
import { temporalLabel } from "@/app/dashboard/metric-text";
import { createMetricService } from "@/application/metrics/metric-composition";
import { IronTrialPortfolioService } from "@/application/customer/iron-trial-portfolio-service";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
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
  searchParams: Promise<{ productId?: string; page?: string }>;
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
  const params = await searchParams;
  const requestedProductId = params.productId?.trim();
  const requestedPage = params.page && /^\\d+$/.test(params.page) ? Number(params.page) : 1;
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
  const ironTrials = await new IronTrialPortfolioService().read(context, selectedProduct?.id, requestedPage);
  const timeZone = ironTrials.status === "ready" ? await getCompanyTimeZone(context.tenantId) : "UTC";
  const dateLabel = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(iso));
  const trialsPageUrl = (page: number) => {
    const query = new URLSearchParams();
    if (selectedProduct) query.set("productId", selectedProduct.id);
    query.set("page", String(page));
    return "/dashboard/trials?" + query.toString();
  };

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
            <span className="metric-label">{labels.metricName(target.metricId, target.displayName)}</span>
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

      {ironTrials.status !== "not_applicable" && (
        <section className="panel" aria-labelledby="iron-trial-customers-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t("trials.iron.eyebrow")}</span>
              <h2 id="iron-trial-customers-title">{t("trials.iron.title")}</h2>
            </div>
            <Link href={selectedProduct
              ? `/dashboard/trials?productId=${encodeURIComponent(selectedProduct.id)}`
              : "/dashboard/trials"}>{t("trials.iron.refresh")}</Link>
          </div>
          <p>{t("trials.iron.note")}</p>
          {ironTrials.status === "unavailable" ? (
            <p role="status">{t("trials.iron.unavailable")}</p>
          ) : (
            <>
              <p>{t("trials.iron.total", { count: ironTrials.total })} · {t("trials.iron.asOf", { date: dateLabel(ironTrials.asOf) })}</p>
              <p className="metric-provenance">{t("trials.iron.source")}</p>
              {ironTrials.customers.length === 0 ? (
                <p role="status">{t("trials.iron.empty")}</p>
              ) : (
                <div className="foundation-grid" aria-label={t("trials.iron.listAria")}>
                  {ironTrials.customers.map((gym) => (
                    <article key={gym.gymId}>
                      <strong>{gym.gymName}</strong>
                      <span>{t("trials.iron.registered", { date: dateLabel(gym.gymCreatedAt) })}</span>
                      <span>{t("trials.iron.started", { date: dateLabel(gym.trialStartedAt) })}</span>
                      <span>{t("trials.iron.ends", { date: dateLabel(gym.trialEndsAt) })}</span>
                      <span>{gym.trialStatus === "active" ? t("trials.iron.active") : t("trials.iron.expired")}</span>
                      <span>{t("trials.iron.subscription", { status:
                        gym.subscriptionStatus === "ACTIVE" ? t("trials.iron.subscriptionActive") :
                        gym.subscriptionStatus === "SUSPENDED" ? t("trials.iron.subscriptionSuspended") :
                        t("trials.iron.subscriptionCanceled") })}</span>
                      <span>{gym.planCode === "IRON_V1_TRIAL"
                        ? t("trials.iron.planTrial")
                        : t("trials.iron.planOther")}</span>
                    </article>
                  ))}
                </div>
              )}
              {ironTrials.pageCount > 1 && (
                <nav className="command-quick-actions" aria-label={t("trials.iron.pagination")}>
                  <span>{t("trials.iron.page", { page: ironTrials.page, pages: ironTrials.pageCount })}</span>
                  {ironTrials.page > 1 && <Link href={trialsPageUrl(ironTrials.page - 1)}>{t("trials.iron.previous")}</Link>}
                  {ironTrials.page < ironTrials.pageCount &&
                    <Link href={trialsPageUrl(ironTrials.page + 1)}>{t("trials.iron.next")}</Link>}
                </nav>
              )}
            </>
          )}
        </section>
      )}

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
          promptPrefix: t("trials.corePrompt"),
        }}
      />
    </main>
  );
}
