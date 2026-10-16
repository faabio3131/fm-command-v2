import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { normalizeRole, roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { member, organization, user } from "@/infrastructure/db/auth-schema";
import { createTranslator } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { SettingsIdentityAdmin } from "./settings-identity-admin";

export default async function SettingsPage() {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const canReadSources = roleHasPermission(context.role, "source:read");
  const canManageTenant = roleHasPermission(context.role, "tenant:manage");
  const canManageMembers = roleHasPermission(context.role, "member:manage");

  const [organizationRows, memberRows] = await Promise.all([
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      })
      .from(organization)
      .where(eq(organization.id, context.tenantId))
      .limit(1),
    canManageMembers
      ? db
          .select({
            id: member.id,
            userId: member.userId,
            role: member.role,
            name: user.name,
            email: user.email,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(eq(member.organizationId, context.tenantId))
      : Promise.resolve([]),
  ]);

  const activeOrganization = organizationRows[0];
  if (!activeOrganization) redirect("/onboarding");

  return (
    <main className="dashboard-shell dashboard-shell-compact settings-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("settings.eyebrow")}</span>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>

      {canManageTenant || canManageMembers ? (
        <SettingsIdentityAdmin
          organization={activeOrganization}
          members={memberRows.map((row) => ({
            ...row,
            role: normalizeRole(row.role),
          }))}
          currentUserId={context.userId}
          canManageTenant={canManageTenant}
          canManageMembers={canManageMembers}
        />
      ) : (
        <section className="panel">
          <h2>{t("settings.org")}</h2>
          <p>{t("settings.orgReadOnly", { name: activeOrganization.name })}</p>
        </section>
      )}

      <section className="executive-section" aria-labelledby="settings-authorities-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("settings.auth.eyebrow")}</span>
            <h2 id="settings-authorities-title">{t("settings.auth.title")}</h2>
          </div>
          <p>{t("settings.auth.note")}</p>
        </div>
        <div className="foundation-grid command-action-grid">
          <Link href="/dashboard#product-intelligence-title">
            <strong>{t("settings.link.products")}</strong>
            <span>{t("settings.link.productsNote")}</span>
          </Link>
          {canReadSources ? (
            <Link href="/dashboard/sources">
              <strong>{t("settings.link.sources")}</strong>
              <span>{t("settings.link.sourcesNote")}</span>
            </Link>
          ) : null}
          <Link href="/dashboard/alerts">
            <strong>{t("settings.link.alerts")}</strong>
            <span>{t("settings.link.alertsNote")}</span>
          </Link>
          <Link href="/dashboard/intelligence">
            <strong>{t("settings.link.core")}</strong>
            <span>{t("settings.link.coreNote")}</span>
          </Link>
          <Link href="/dashboard/customers">
            <strong>{t("settings.link.customers")}</strong>
            <span>{t("settings.link.customersNote")}</span>
          </Link>
          <Link href="/dashboard/operations">
            <strong>{t("settings.link.ops")}</strong>
            <span>{t("settings.link.opsNote")}</span>
          </Link>
        </div>
      </section>

      <section className="panel">
        <h2>{t("settings.scope")}</h2>
        <p>{t("settings.scopeText", { org: activeOrganization.name, role: labels.role(context.role) })}</p>
      </section>
    </main>
  );
}
