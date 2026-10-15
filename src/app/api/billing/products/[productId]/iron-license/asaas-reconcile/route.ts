import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { verifyPasswordStepUp } from "@/application/security/password-step-up";
import { requirePermission } from "@/domain/security/tenant-context";
import { environmentIronControlTenantId } from "@/infrastructure/integration/iron-commercial-connector";
import { AsaasIronPaymentReadOnlyClient } from "@/infrastructure/billing/asaas-iron-payment-readonly-client";
import { PostgresIronAsaasAtomicReconciliation } from "@/infrastructure/billing/postgres-iron-asaas-atomic-reconciliation";
import { pool } from "@/infrastructure/db/client";

export const dynamic = "force-dynamic";

/**
 * Manual read-only provider verification + atomic billing event recording.
 * No payment POST, webhook claim, scheduler, or IRON outbound delivery here.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  if (process.env.FMCC_IRON_ASAAS_ATOMIC_RECONCILIATION_ENABLED !== "YES") {
    return NextResponse.json({ error: "billing.iron_asaas_reconciliation_disabled" }, { status: 503 });
  }
  try {
    const requestHeaders = await headers();
    const context = await resolveTenantContext(requestHeaders);
    requirePermission(context, "billing:write");
    if ((context.role !== "owner" && context.role !== "admin") ||
        !environmentIronControlTenantId() || context.tenantId !== environmentIronControlTenantId()) {
      return NextResponse.json({ error: "billing.iron_asaas_scope_denied" }, { status: 403 });
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "billing.invalid_request" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    if (typeof input.password !== "string" || typeof input.invoiceId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.invoiceId)) {
      return NextResponse.json({ error: "billing.invalid_request" }, { status: 400 });
    }
    const stepUp = await verifyPasswordStepUp(requestHeaders, input.password);
    if (stepUp.userId !== context.userId) {
      return NextResponse.json({ error: "security.step_up_required" }, { status: 403 });
    }
    const { productId } = await params;
    const ledger = new PostgresIronAsaasAtomicReconciliation(pool);
    const binding = await ledger.binding(context.tenantId, productId, input.invoiceId);
    if (!binding) {
      return NextResponse.json({ error: "billing.iron_asaas_binding_not_verified" }, { status: 409 });
    }
    const payment = await new AsaasIronPaymentReadOnlyClient().verify({
      paymentId: binding.paymentId, customerId: binding.customerId,
      invoiceId: binding.invoiceId, amountMinor: binding.amountMinor,
    });
    const result = await ledger.commitVerified(context, binding, payment);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "billing.iron_asaas_reconciliation_denied_or_unverified" }, { status: 409 });
  }
}
