import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { buildReportService } from "@/application/reports/report-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { ReportsPanel } from "./reports-panel";

export default async function ReportsPage() {
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
  let reports;
  try { reports = await buildReportService().list(context); }
  catch (error) {
    if (error instanceof PermissionDeniedError) redirect("/dashboard");
    throw error;
  }
  const canWrite = roleHasPermission(context.role, "report:write");
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("reports.eyebrow")}</span>
          <h1>{t("reports.title")}</h1>
          <p>{t("reports.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>
      {canWrite ? null : <p className="panel">{t("reports.readOnly")}</p>}
      <p><Link href="/dashboard/channels">{t("reports.channelsHint")}</Link></p>
      <ReportsPanel
        canWrite={canWrite}
        locale={locale}
        metrics={METRIC_REGISTRY.map((m) => ({ id: m.metricId, name: labels.metricName(m.metricId, m.displayName) }))}
        reports={reports.map((r) => ({ id: r.id, name: r.name, frequency: r.frequency, hour: r.hour, weekday: r.weekday, dayOfMonth: r.dayOfMonth, enabled: r.enabled, metricCount: r.metricIds.length, lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null }))}
      />
    </main>
  );
}
