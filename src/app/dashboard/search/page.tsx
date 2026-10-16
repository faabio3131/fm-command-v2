import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { buildGlobalSearchService } from "@/application/search/global-search-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  GlobalSearchRateLimitError,
  type GlobalSearchOverview,
  type GlobalSearchResultKind,
} from "@/domain/search/contracts";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { GlobalSearchForm } from "./global-search-form";

const RESULT_GROUPS: readonly GlobalSearchResultKind[] = ["navigation", "metric", "product", "source", "alert_rule", "alert_occurrence", "activity"];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (!roleHasPermission(context.role, "search:use")) {
    redirect("/dashboard");
  }

  const { t } = createTranslator(await getRequestLocale());
  const query = (await searchParams).q?.trim() ?? "";
  let overview: GlobalSearchOverview | null = null;
  let validationMessage = "";

  if (query) {
    if (query.length < 2 || query.length > 80) {
      validationMessage = t("search.err.length");
    } else {
      try {
        overview = await buildGlobalSearchService().search(context, query, 50);
      } catch (error) {
        if (error instanceof GlobalSearchRateLimitError) {
          validationMessage = t("search.err.rate", { seconds: error.retryAfterSeconds });
        } else {
          throw error;
        }
      }
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("search.eyebrow")}</span>
          <h1>{t("search.title")}</h1>
          <p>{t("search.lead")}</p>
        </div>
        <Link className="button" href="/dashboard">
          {t("search.back")}
        </Link>
      </header>

      <section className="panel">
        <GlobalSearchForm query={query} />
        <p>{t("search.note")}</p>
      </section>

      {validationMessage ? (
        <section className="panel" role="alert">
          <strong>{t("search.unavailable")}</strong>
          <p>{validationMessage}</p>
        </section>
      ) : null}

      {overview ? (
        <>
          <section className="metric-grid" aria-label={t("search.coverageAria")}>
            <article className="metric-card">
              <span className="metric-label">{t("search.results")}</span>
              <strong>{overview.counts.returned}</strong>
              <small>{t("search.matches", { count: overview.counts.totalMatches })}</small>
            </article>
            <article className="metric-card">
              <span className="metric-label">{t("search.productsSources")}</span>
              <strong>
                {overview.counts.products} / {overview.counts.sources}
              </strong>
              <small>{t("search.productsSourcesNote")}</small>
            </article>
            <article className="metric-card">
              <span className="metric-label">{t("search.metrics")}</span>
              <strong>{overview.counts.metrics}</strong>
              <small>{t("search.metricsNote")}</small>
            </article>
            <article className="metric-card">
              <span className="metric-label">{t("search.alertsActivity")}</span>
              <strong>
                {overview.counts.alertRules + overview.counts.alertOccurrences} /{" "}
                {overview.counts.activities}
              </strong>
              <small>{t("search.alertsActivityNote")}</small>
            </article>
          </section>

          <section className="executive-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{t("search.query")}</span>
                <h2>{t("search.resultsFor", { query: overview.query })}</h2>
              </div>
              <p>{overview.coverageNote}</p>
            </div>

            {overview.items.length ? (
              RESULT_GROUPS.map((group) => {
                const items = overview.items.filter(
                  (item) => item.kind === group,
                );
                if (!items.length) return null;
                return (
                  <section className="panel" key={group}>
                    <h3>{t(`search.group.${group}` as MessageKey)}</h3>
                    <div className="product-grid">
                      {items.map((item) => (
                        <Link
                          className="product-card"
                          href={item.href}
                          key={item.id}
                        >
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                          <small>{t("search.authority", { value: item.authority })}</small>
                        </Link>
                      ))}
                    </div>
                  </section>
                );
              })
            ) : (
              <article className="product-card">
                <strong>{t("search.noneTitle")}</strong>
                <small>{t("search.noneText")}</small>
              </article>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
