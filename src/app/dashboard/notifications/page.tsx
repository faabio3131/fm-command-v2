import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
import { buildNotificationService } from "@/application/notifications/notification-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import { NotificationList } from "./notification-list";

export default async function NotificationsPage() {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (!roleHasPermission(context.role, "notification:use")) {
    redirect("/dashboard");
  }

  const { t } = createTranslator(await getRequestLocale());
  const [inbox, timeZone] = await Promise.all([buildNotificationService().inbox(context, 50), getCompanyTimeZone(context.tenantId)]);

  return (
    <main className="dashboard-shell dashboard-shell-compact notifications-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("notifications.page.eyebrow")}</span>
          <h1>{t("notifications.page.title")}</h1>
          <p>
            {t("notifications.page.lead")}
          </p>
        </div>
        <Link className="button" href="/dashboard">
          {t("notifications.page.back")}
        </Link>
      </header>

      <section className="metric-grid" aria-label={t("notifications.page.summaryAria")}>
        <article className="metric-card">
          <span className="metric-label">{t("notifications.page.unread")}</span>
          <strong>{inbox.unreadCount}</strong>
          <small>{t("notifications.page.unreadNote")}</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">{t("notifications.page.eligible")}</span>
          <strong>{inbox.totalCount}</strong>
          <small>{t("notifications.page.eligibleNote")}</small>
        </article>
      </section>

      <section className="panel">
        <h2>{t("notifications.page.boundary")}</h2>
        <p>{inbox.dataBoundary}</p>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("notifications.page.eyebrow2")}</span>
            <h2>{t("notifications.page.inbox")}</h2>
          </div>
          <p>
            {t("notifications.page.inboxNote")}
          </p>
        </div>
        <NotificationList items={inbox.items} timeZone={timeZone} />
      </section>
    </main>
  );
}
