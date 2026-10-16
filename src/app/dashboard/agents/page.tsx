import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildAgentService } from "@/application/agents/agent-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { currencyExponent } from "@/domain/core/currency-exponent";
import { roleHasPermission } from "@/domain/security/permissions";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import { AgentsPanel } from "./agents-panel";

export default async function AgentsPage() {
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
  try { overview = await buildAgentService().overview(context); }
  catch (error) {
    if (error instanceof PermissionDeniedError) redirect("/dashboard");
    throw error;
  }
  const { budget, usage, drafts } = overview;
  // Valores guardados em milionésimos da unidade menor; a tela mostra na moeda, com a casa decimal da moeda.
  const money = (micro: number, currency: string) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micro / 1_000_000 / 10 ** currencyExponent(currency));
  const canWrite = roleHasPermission(context.role, "agent:write");
  const canApprove = roleHasPermission(context.role, "agent:approve");
  const canBudget = roleHasPermission(context.role, "agent:budget");
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("agents.eyebrow")}</span>
          <h1>{t("agents.title")}</h1>
          <p>{t("agents.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>
      {canWrite || canApprove ? null : <p className="panel">{t("agents.readOnly")}</p>}
      <AgentsPanel
        canWrite={canWrite} canApprove={canApprove} canBudget={canBudget}
        budget={budget ? {
          enabled: budget.enabled, currency: budget.currency,
          capMinor: budget.capMicroMinor / 1_000_000, reserveMinor: budget.reserveMicroMinor / 1_000_000,
          summary: usage ? t("agents.budget.spent", { spent: money(usage.spentMicroMinor, budget.currency), cap: money(budget.capMicroMinor, budget.currency), currency: budget.currency, inFlight: usage.inFlight }) : "",
        } : null}
        drafts={drafts.map((d) => ({
          id: d.id, period: d.periodKey, status: d.status, errorCode: d.errorCode,
          subject: d.finalSubject ?? d.draftSubject ?? "", body: d.finalBody ?? d.draftBody ?? "", unverified: d.unverifiedNumbers, inputs: d.inputLines,
          cost: d.costMicroMinor !== null && d.currency ? { text: money(d.costMicroMinor, d.currency), currency: d.currency } : null, sentQueued: d.sentQueued,
        }))}
      />
    </main>
  );
}
