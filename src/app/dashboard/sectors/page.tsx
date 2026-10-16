import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { SectorsPanel } from "./sectors-panel";

export default async function SectorsPage() {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }
  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  let overview;
  try { overview = await buildSectorService().overview(context); }
  catch (error) {
    if (error instanceof PermissionDeniedError) redirect("/dashboard");
    throw error;
  }
  const canWrite = roleHasPermission(context.role, "sector:write");
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("sectors.eyebrow")}</span>
          <h1>{t("sectors.title")}</h1>
          <p>{t("sectors.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>
      {canWrite ? null : <p className="panel">{t("sectors.readOnly")}</p>}
      <SectorsPanel
        canWrite={canWrite}
        packs={overview.map(({ pack, enabled }) => ({
          id: pack.id,
          label: pack.label[locale],
          description: pack.description[locale],
          enabled,
          metrics: pack.metrics.length,
          facts: pack.facts.map((f) => ({
            factType: f.factType,
            description: f.description[locale],
            money: f.money,
            statuses: (Object.entries(f.statusMeaning) as [string, { [k: string]: string }][]).map(([status, text]) => ({ status: t(`sectors.status.${status}` as MessageKey), meaning: text[locale] })),
          })),
        }))}
      />
    </main>
  );
}
