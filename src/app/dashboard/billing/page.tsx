import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { requirePermission } from "@/domain/security/tenant-context";
import { PilotCheckout } from "./pilot-checkout";

export const dynamic = "force-dynamic";

export default async function BillingPilotPage() {
  let permitted = false;
  try {
    const context = await resolveTenantContext(await headers());
    requirePermission(context, "billing:read");
    permitted = context.role === "owner" || context.role === "admin";
  } catch {
    redirect("/sign-in");
  }
  if (!permitted) redirect("/dashboard");
  return <main className="dashboard-shell"><header className="dashboard-header"><div>
    <span className="eyebrow">FM Tecnologia · Billing Centralizado</span>
    <h1>Checkout de homologação</h1>
    <p>Compra simulada de R$ 1,00 com pagamento real desabilitado até certificação.</p>
  </div></header><PilotCheckout /></main>;
}
