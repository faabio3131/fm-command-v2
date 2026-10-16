import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
import { buildActivityFeedService } from "@/application/activity/activity-feed-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ActivityFeedItem,
} from "@/domain/activity/contracts";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { formatDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { createTranslator, type MessageKey } from "@/i18n/translate";

const FILTERS: readonly { value: "all" | ActivityCategory; labelKey: MessageKey }[] = [
  { value: "all", labelKey: "activity.filter.all" },
  { value: "finance", labelKey: "activity.filter.finance" },
  { value: "commercial", labelKey: "activity.filter.commercial" },
  { value: "operations", labelKey: "activity.filter.operations" },
  { value: "system", labelKey: "activity.filter.system" },
  { value: "security", labelKey: "activity.filter.security" },
];

function amountLabel(item: ActivityFeedItem, locale: Locale): string | null {
  if (!item.amount) return null;
  if (item.currency) {
    const numeric = Number(item.amount);
    if (Number.isFinite(numeric)) {
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: item.currency,
        }).format(numeric);
      } catch {
        return `${item.amount} ${item.currency}`;
      }
    }
  }
  return item.unit ? `${item.amount} ${item.unit}` : item.amount;
}

function pageHref(
  category: ActivityCategory | undefined,
  page: number,
  productId?: string,
) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  if (productId) params.set("productId", productId);
  const query = params.toString();
  return query ? `/dashboard/activity?${query}` : "/dashboard/activity";
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    page?: string;
    productId?: string;
  }>;
}) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (!roleHasPermission(context.role, "audit:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const category =
    params.category && params.category !== "all"
      ? (params.category as ActivityCategory)
      : undefined;
  if (category && !ACTIVITY_CATEGORIES.includes(category)) {
    redirect("/dashboard/activity");
  }

  const page = params.page ? Number(params.page) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 25) {
    redirect("/dashboard/activity");
  }

  const productId = params.productId?.trim() || undefined;
  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const [feed, timeZone] = await Promise.all([
    buildActivityFeedService().page(context, { category, productId, page, pageSize: 20 }),
    getCompanyTimeZone(context.tenantId),
  ]);
  const categoryLabel = (value: ActivityCategory) => {
    const filter = FILTERS.find((f) => f.value === value);
    return filter ? t(filter.labelKey) : value;
  };
  const dateLabel = (value: string) =>
    Number.isNaN(new Date(value).getTime()) ? t("common.dateUnavailable") : formatDateTime(value, locale, timeZone);

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("activity.eyebrow")}</span>
          <h1>{t("activity.title")}</h1>
          <p>
            {t("activity.lead")}
          </p>
        </div>
        <Link className="button" href="/dashboard">
          {t("activity.back")}
        </Link>
      </header>

      <section className="panel">
        <h2>{t("activity.boundary")}</h2>
        <p>{feed.dataBoundary}</p>
        <p>{feed.windowNote}</p>
      </section>

      <nav className="panel" aria-label={t("activity.filtersAria")}>
        <strong>{t("activity.filterBy")}</strong>
        <div className="command-quick-actions">
          {FILTERS.map((filter) => {
            const active = filter.value === (category ?? "all");
            return (
              <Link
                className={active ? "button primary" : "button"}
                aria-current={active ? "page" : undefined}
                href={pageHref(
                  filter.value === "all" ? undefined : filter.value,
                  1,
                  productId,
                )}
                key={filter.value}
              >
                {t(filter.labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("activity.projection")}</span>
            <h2>{t("activity.timeline")}</h2>
          </div>
          <p>
            {t("activity.timelineNote")}
          </p>
        </div>

        <div className="product-grid">
          {feed.items.length ? (
            feed.items.map((item) => {
              const amount = amountLabel(item, locale);
              return (
                <article className="product-card" key={item.id}>
                  <span className="eyebrow">
                    {categoryLabel(item.category)} · {dateLabel(item.occurredAt)}
                  </span>
                  <strong>{item.title}</strong>
                  <small>{t("activity.type", { value: item.eventType })}</small>
                  {amount ? <small>{t("activity.amount", { value: amount })}</small> : null}
                  {item.result ? <small>{t("activity.result", { value: item.result })}</small> : null}
                  {item.actorRef ? <small>{t("activity.actor", { value: item.actorRef })}</small> : null}
                  {item.productId ? (
                    <small>{t("activity.product", { value: item.productId })}</small>
                  ) : null}
                  <small>{t("activity.authority", { value: item.sourceAuthority })}</small>
                  <small>{t("activity.provenance", { value: item.provenanceRefs.join(" · ") })}</small>
                  {item.correlationId ? (
                    <small>{t("activity.correlation", { value: item.correlationId })}</small>
                  ) : null}
                </article>
              );
            })
          ) : (
            <article className="product-card">
              <strong>{t("activity.emptyTitle")}</strong>
              <small>{t("activity.emptyText")}</small>
            </article>
          )}
        </div>
      </section>

      <nav className="panel" aria-label={t("activity.paginationAria")}>
        {feed.pagination.hasPrevious ? (
          <Link
            className="button"
            rel="prev"
            href={pageHref(category, page - 1, productId)}
          >
            {t("activity.prev")}
          </Link>
        ) : null}
        <span>{t("activity.page", { page })}</span>
        {feed.pagination.hasNext ? (
          <Link
            className="button"
            rel="next"
            href={pageHref(category, page + 1, productId)}
          >
            {t("activity.next")}
          </Link>
        ) : null}
      </nav>
    </main>
  );
}
