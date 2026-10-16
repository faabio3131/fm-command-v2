import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { requirePermission } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { billingGatewayAccounts, billingInvoices, billingProviderPayments } from "@/infrastructure/db/billing-schema";
import { productDefinitions } from "@/infrastructure/db/platform-schema";

export const dynamic = "force-dynamic";
const PILOT_INVOICE_ID = "a51a5000-1990-4000-8000-000000000001";

/**
 * Read-only checkout preflight. No Asaas API call and no payment creation.
 * Fail-closed until the active session belongs to the invoice tenant.
 */
export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    requirePermission(context, "billing:read");
    if (context.role !== "owner" && context.role !== "admin")
      return NextResponse.json({ error: "billing.admin_required" }, { status: 403 });

    const rows = await db.select({
      invoiceId: billingInvoices.id,
      tenantId: billingInvoices.tenantId,
      productName: productDefinitions.name,
      amountMinor: billingInvoices.amountMinor,
      currency: billingInvoices.currency,
      invoiceStatus: billingInvoices.status,
      gatewayStatus: billingGatewayAccounts.status,
      gatewayEnvironment: billingGatewayAccounts.environment,
      gatewayProvider: billingGatewayAccounts.provider,
      gatewayAccountId: billingGatewayAccounts.id,
    }).from(billingInvoices)
      .innerJoin(productDefinitions, and(
        eq(productDefinitions.id, billingInvoices.productId),
        eq(productDefinitions.tenantId, billingInvoices.tenantId),
      ))
      .innerJoin(billingGatewayAccounts, and(
        eq(billingGatewayAccounts.id, billingInvoices.gatewayAccountId),
        eq(billingGatewayAccounts.tenantId, billingInvoices.tenantId),
      ))
      .where(and(
        eq(billingInvoices.id, PILOT_INVOICE_ID),
        eq(billingInvoices.tenantId, context.tenantId),
      )).limit(1);

    if (!rows.length) return NextResponse.json({ error: "billing.invoice_unavailable" }, { status: 404 });
    const invoice = rows[0];
    const payments = await db.select({ id: billingProviderPayments.id, externalPaymentId: billingProviderPayments.externalPaymentId, paymentStatus: billingProviderPayments.status })
      .from(billingProviderPayments)
      .where(and(
        eq(billingProviderPayments.tenantId, context.tenantId),
        eq(billingProviderPayments.invoiceId, invoice.invoiceId),
      )).limit(1);

    const valid = invoice.productName === "Kordena" &&
      invoice.amountMinor === 100 && invoice.currency === "BRL" &&
      invoice.gatewayProvider === "asaas" && invoice.gatewayEnvironment === "production";
    if (!valid) return NextResponse.json({ error: "billing.pilot_scope_invalid" }, { status: 409 });

    return NextResponse.json({
      invoiceId: invoice.invoiceId,
      product: invoice.productName,
      value: "1.00",
      currency: invoice.currency,
      invoiceStatus: invoice.invoiceStatus,
      provider: "asaas",
      paymentMethods: ["PIX"],
      existingPayment: payments.length > 0,
      paymentId: payments[0]?.externalPaymentId ?? null,
      paymentStatus: payments[0]?.paymentStatus ?? null,
      gatewayReady: invoice.gatewayStatus === "enabled",
      providerCredentialConfigured: Boolean(process.env.FMCC_ASAAS_PRODUCTION_API_KEY?.trim()),
      canCreatePayment: process.env.FMCC_PILOT_PIX_ISSUANCE_ENABLED === "YES" && invoice.gatewayStatus === "enabled" && invoice.invoiceStatus === "pending" && payments.length === 0,
      reason: "billing.checkout_issuance_not_certified",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "billing.checkout_denied" }, { status: 403 });
  }
}
