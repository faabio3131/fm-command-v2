import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { buildUnitAdminService } from "@/application/organization/unit-admin-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import { StructurePanel } from "./structure-panel";

export default async function StructurePage() {
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
  try { overview = await buildUnitAdminService().overview(context); }
  catch (error) {
    if (error instanceof PermissionDeniedError) redirect("/dashboard");
    throw error;
  }
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("structure.eyebrow")}</span>
          <h1>{t("structure.title")}</h1>
          <p>{t("structure.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>
      <p className="panel" role="note">{t("structure.warning")}</p>
      <StructurePanel
        units={overview.units.map((u) => ({ id: u.id, parentId: u.parentId, kind: u.kind, name: u.name }))}
        members={overview.members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role }))}
        grants={overview.grants.map((g) => ({ userId: g.userId, unitId: g.unitId }))}
      />
    </main>
  );
}
