import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildChannelService } from "@/application/channels/channel-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import { ChannelsPanel } from "./channels-panel";

export default async function ChannelsPage() {
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
  try { overview = await buildChannelService().overview(context); }
  catch (error) {
    if (error instanceof PermissionDeniedError) redirect("/dashboard");
    throw error;
  }
  const canWrite = roleHasPermission(context.role, "channel:write");
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("channels.eyebrow")}</span>
          <h1>{t("channels.title")}</h1>
          <p>{t("channels.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>
      {canWrite ? null : <p className="panel">{t("channels.readOnly")}</p>}
      <ChannelsPanel
        canWrite={canWrite}
        providers={overview.providers.map((p) => ({ id: p.id, kind: p.kind, credential: p.credential, simulated: p.simulated }))}
        configs={overview.configs.map((c) => ({ kind: c.kind, providerId: c.providerId, sender: c.sender, enabled: c.enabled, minSeverity: c.minSeverity, hasKey: c.secretRef !== null }))}
        recipients={overview.recipients.map((r) => ({ id: r.id, kind: r.kind, address: r.address, label: r.label, enabled: r.enabled }))}
        deliveries={overview.deliveries.map((d) => ({ id: d.id, kind: d.kind, recipient: d.recipient, status: d.status, errorCode: d.errorCode, when: iso(d.sentAt ?? d.createdAt) as string }))}
        locale={locale}
      />
    </main>
  );
}
