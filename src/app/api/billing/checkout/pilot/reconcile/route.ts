import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { verifyPasswordStepUp } from "@/application/security/password-step-up";
import { requirePermission } from "@/domain/security/tenant-context";
import { db, pool } from "@/infrastructure/db/client";
import { billingInvoices, billingProviderPayments } from "@/infrastructure/db/billing-schema";
import { AsaasProductionPilot } from "@/infrastructure/billing/asaas-production-pilot";
import { AsaasCheckoutClient } from "@/infrastructure/billing/asaas-checkout-client";
import { ProductionPilotLedger } from "@/infrastructure/billing/production-pilot-ledger";

export const dynamic = "force-dynamic";
const INVOICE = "a51a5000-1990-4000-8000-000000000001";

/** Reconciliation is GET-to-provider only, followed by transactionally protected local state change. */
export async function POST(request: Request) {
  if (process.env.FMCC_PILOT_PIX_ISSUANCE_ENABLED !== "YES")
    return NextResponse.json({ error: "billing.pilot_disabled" }, { status: 503 });
  try {
    const requestHeaders = await headers();
    const ctx = await resolveTenantContext(requestHeaders);
    requirePermission(ctx,"billing:write");
    if (ctx.role !== "owner" && ctx.role !== "admin")
      return NextResponse.json({ error: "billing.admin_required" }, { status: 403 });
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof (body as Record<string,unknown>).password !== "string")
      return NextResponse.json({ error: "billing.invalid_request" }, { status: 400 });
    const proof = await verifyPasswordStepUp(requestHeaders,(body as { password:string }).password);
    if (proof.userId !== ctx.userId)
      return NextResponse.json({ error:"billing.step_up_required" },{status:403});
    const [invoice] = await db.select({ id:billingInvoices.id,gatewayId:billingInvoices.gatewayAccountId })
      .from(billingInvoices).where(and(eq(billingInvoices.tenantId,ctx.tenantId),eq(billingInvoices.id,INVOICE))).limit(1);
    if (!invoice) return NextResponse.json({error:"billing.invoice_not_found"},{status:404});
    const [payment] = await db.select({ id:billingProviderPayments.externalPaymentId })
      .from(billingProviderPayments).where(and(eq(billingProviderPayments.tenantId,ctx.tenantId),
        eq(billingProviderPayments.invoiceId,INVOICE),eq(billingProviderPayments.gatewayAccountId,invoice.gatewayId))).limit(1);
    if (!payment) return NextResponse.json({error:"billing.payment_not_recorded_recovery_required"},{status:409});
    const pilot = new AsaasProductionPilot(new ProductionPilotLedger(pool));
    const status = await pilot.reconcileRealPix({
      tenantId:ctx.tenantId,invoiceId:INVOICE,gatewayAccountId:invoice.gatewayId,externalPaymentId:payment.id,
    });
    const pix = status === "pending" ? await new AsaasCheckoutClient().pixCode(payment.id).catch(() => null) : null;
    return NextResponse.json({status,paymentId:payment.id,pix},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({error:"billing.reconciliation_failed"},{status:409});
  }
}
