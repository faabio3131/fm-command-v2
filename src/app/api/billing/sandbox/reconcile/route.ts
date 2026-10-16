import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { verifyPasswordStepUp } from "@/application/security/password-step-up";
import { requirePermission } from "@/domain/security/tenant-context";
import { CanonicalBillingService } from "@/application/billing/canonical-billing-service";
import { PostgresCanonicalBillingRepository } from "@/infrastructure/billing/postgres-canonical-billing-repository";
import { AsaasSandboxClient } from "@/infrastructure/billing/asaas-sandbox-client";

/** Governed manual reconciliation only. Charge creation is intentionally not exposed
 * until checkout idempotency/recovery and customer ownership are independently certified.
 */
export async function POST(request: Request) {
  let context: Awaited<ReturnType<typeof resolveTenantContext>> | undefined;
  try {
    const requestHeaders = await headers();
    context = await resolveTenantContext(requestHeaders);
    requirePermission(context, "billing:write");
    if (context.role !== "owner" && context.role !== "admin")
      return NextResponse.json({ error: "billing.admin_required" }, { status: 403 });
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ error: "billing.request_invalid" }, { status: 400 });
    const input = body as Record<string, unknown>;
    if (typeof input.password !== "string" || typeof input.invoiceId !== "string" || typeof input.paymentId !== "string"
      || !/^[0-9a-f-]{36}$/i.test(input.invoiceId) || !/^[A-Za-z0-9_-]{1,128}$/.test(input.paymentId))
      return NextResponse.json({ error: "billing.request_invalid" }, { status: 400 });
    const proof = await verifyPasswordStepUp(requestHeaders, input.password);
    if (proof.userId !== context.userId)
      return NextResponse.json({ error: "billing.step_up_required" }, { status: 403 });
    const result = await new CanonicalBillingService(
      new PostgresCanonicalBillingRepository(), new AsaasSandboxClient(),
    ).reconcile(context.tenantId, input.invoiceId, input.paymentId);
    await recordAuditEvent(context, {
      action: "billing.sandbox.reconciliation",
      resourceType: "billing_invoice",
      result: "success",
      metadata: { invoiceId: input.invoiceId, result },
    });
    return NextResponse.json({ status: result });
  } catch (error) {
    if (context) {
      await recordAuditEvent(context, {
        action: "billing.sandbox.reconciliation",
        resourceType: "billing_invoice",
        result: "failure",
        metadata: { errorType: error instanceof Error ? error.name : "unknown" },
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: "billing.reconciliation_denied_or_failed" }, { status: 403 });
  }
}
