import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { CaktoPaymentProvider } from "@/infrastructure/subscription/cakto-payment-provider";
import { db } from "@/infrastructure/db/client";
import { billingGatewayAccounts, billingGatewayEvents, billingInvoices, billingIronEntitlementOutbox, billingProductPlans, billingProviderPayments, billingSubscriptions } from "@/infrastructure/db/billing-schema";
import type { PaymentEvent } from "@/domain/subscription/payment-provider";

/**
 * Unlike FM Command's own /subscription service, this is the canonical
 * FM Command -> IRON product billing ledger and outbox.
 *
 * A purchase is never attributed by email, purchaser CPF, checkout redirect,
 * or a tenantId from the webhook. Only a previously prepared invoice UUID
 * linked to the configured FM billing tenant and product may be settled.
 */
export class CaktoIronProductBilling {
  private readonly tenantId: string;
  private readonly productId: string;
  private readonly provider: CaktoPaymentProvider;

  constructor(private readonly env: Record<string, string | undefined> = process.env) {
    this.tenantId = env.FMCC_IRON_BILLING_TENANT_ID ?? "";
    this.productId = env.FMCC_IRON_PRODUCT_ID ?? "";
    if (!/^[A-Za-z0-9._:-]{3,128}$/.test(this.tenantId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.productId)) {
      throw new Error("cakto.iron_scope_not_configured");
    }
    this.provider = new CaktoPaymentProvider(env);
  }

  private async boundInvoice(invoiceId: string) {
    const rows = await db.select({
      invoice: billingInvoices,
      subscription: billingSubscriptions,
      gateway: billingGatewayAccounts,
      plan: billingProductPlans,
    }).from(billingInvoices)
      .innerJoin(billingSubscriptions, and(eq(billingSubscriptions.tenantId, billingInvoices.tenantId),
        eq(billingSubscriptions.id, billingInvoices.subscriptionId),
        eq(billingSubscriptions.productId, billingInvoices.productId),
        eq(billingSubscriptions.customerId, billingInvoices.customerId)))
      .innerJoin(billingGatewayAccounts, and(eq(billingGatewayAccounts.tenantId, billingInvoices.tenantId),
        eq(billingGatewayAccounts.id, billingInvoices.gatewayAccountId)))
      .innerJoin(billingProductPlans, and(eq(billingProductPlans.tenantId, billingInvoices.tenantId),
        eq(billingProductPlans.productId, billingInvoices.productId),
        eq(billingProductPlans.planCode, billingSubscriptions.planCode)))
      .where(and(eq(billingInvoices.tenantId, this.tenantId),
        eq(billingInvoices.productId, this.productId), eq(billingInvoices.id, invoiceId)))
      .limit(1);
    const r = rows[0];
    if (!r || r.gateway.provider !== "cakto" || r.gateway.environment !== "production" ||
      r.gateway.status !== "enabled" || r.plan.status !== "active" ||
      r.invoice.amountMinor !== r.plan.amountMinor || r.invoice.currency !== "BRL") {
      throw new Error("cakto.invoice_binding_not_ready");
    }
    return r;
  }

  /** Generates checkout ONLY for pre-existing Command invoice, never a site visitor-supplied amount. */
  async checkoutUrl(invoiceId: string): Promise<string> {
    const r = await this.boundInvoice(invoiceId);
    if (r.invoice.status !== "pending" || r.subscription.status !== "pending")
      throw new Error("cakto.invoice_not_pending");
    const interval = r.plan.interval === "monthly" ? "month" : r.plan.interval === "yearly" ? "year" : null;
    if (!interval) throw new Error("cakto.invoice_interval_invalid");
    const result = await this.provider.createSubscription({
      customerRef: r.invoice.customerId,
      externalReference: invoiceId,
      price: { amountMinor: r.invoice.amountMinor, currency: "BRL" },
      interval, description: "IRON FIT CORE - " + r.plan.planCode,
      firstDueDate: new Date().toISOString().slice(0, 10),
    });
    if (!result.checkoutUrl) throw new Error("cakto.checkout_not_available");
    return result.checkoutUrl;
  }

  /** Authentication is done on the unmodified raw body, before database access. */
  async handleWebhook(headers: Headers, raw: string): Promise<"applied" | "duplicate" | "ignored" | "unmatched"> {
    const event = this.provider.verifyWebhook(headers, raw);
    if (!event) return "ignored";
    if (!["payment_confirmed", "payment_refunded"].includes(event.type)) return "ignored";
    if (!event.paymentRef || !/^[A-Za-z0-9_-]{6,128}$/.test(event.paymentRef)) return "ignored";
    let binding: Awaited<ReturnType<typeof this.boundInvoice>>;
    try { binding = await this.boundInvoice(event.subscriptionRef); }
    catch { return "unmatched"; } // No unowned or unknown invoice can be granted.
    if (event.type === "payment_confirmed" && (!event.amount ||
       event.amount.currency !== "BRL" || event.amount.amountMinor !== binding.invoice.amountMinor)) return "ignored";

    // A stable advisory lock serializes multiple delivery attempts of one invoice.
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${event.subscriptionRef}, 0))`);
      const [cur] = await tx.select({ status: billingInvoices.status }).from(billingInvoices)
        .where(and(eq(billingInvoices.tenantId, this.tenantId),
          eq(billingInvoices.productId, this.productId), eq(billingInvoices.id, binding.invoice.id))).limit(1);
      if (!cur) return "unmatched" as const;
      const isPayment = event.type === "payment_confirmed";
      if (isPayment && cur.status !== "pending") return "duplicate" as const;
      if (!isPayment && cur.status !== "paid") return "ignored" as const;

      // A previously confirmed payment always remains tied to one order and one invoice.
      const fingerprint = createHash("sha256").update(raw).digest("hex");
      const [inserted] = await tx.insert(billingGatewayEvents).values({
        tenantId: this.tenantId, gatewayAccountId: binding.gateway.id,
        externalEventId: "cakto:" + event.type + ":" + event.paymentRef,
        status: "processed", eventType: event.type, externalPaymentId: event.paymentRef,
        externalReference: event.subscriptionRef, payloadFingerprint: fingerprint,
        processedAt: new Date(),
      }).onConflictDoNothing().returning({ id: billingGatewayEvents.id });
      if (!inserted) return "duplicate" as const;

      if (isPayment) {
        const [payment] = await tx.insert(billingProviderPayments).values({
          tenantId: this.tenantId, invoiceId: binding.invoice.id,
          gatewayAccountId: binding.gateway.id, externalPaymentId: event.paymentRef!,
          status: "received",
        }).onConflictDoNothing().returning({ id: billingProviderPayments.id });
        if (!payment) throw new Error("cakto.payment_identity_conflict");
      } else {
        const [payment] = await tx.select({ id: billingProviderPayments.id }).from(billingProviderPayments)
          .where(and(eq(billingProviderPayments.tenantId, this.tenantId),
            eq(billingProviderPayments.gatewayAccountId, binding.gateway.id),
            eq(billingProviderPayments.invoiceId, binding.invoice.id),
            eq(billingProviderPayments.externalPaymentId, event.paymentRef!))).limit(1);
        if (!payment) throw new Error("cakto.refund_unknown_payment");
        await tx.update(billingProviderPayments).set({ status: "refunded" }).where(eq(billingProviderPayments.id, payment.id));
      }
      await tx.update(billingInvoices).set({ status: isPayment ? "paid" : "refunded" })
        .where(and(eq(billingInvoices.tenantId, this.tenantId), eq(billingInvoices.id, binding.invoice.id)));
      await tx.update(billingSubscriptions).set({ status: isPayment ? "active" : "past_due" })
        .where(and(eq(billingSubscriptions.tenantId, this.tenantId), eq(billingSubscriptions.id, binding.subscription.id)));
      await tx.insert(billingIronEntitlementOutbox).values({
        tenantId: this.tenantId, productId: this.productId, invoiceId: binding.invoice.id,
        subscriptionId: binding.subscription.id,
        eventType: isPayment ? "LICENSE_ACTIVATE" : "LICENSE_SUSPEND",
        idempotencyKey: "cakto:" + event.type + ":" + event.paymentRef,
        status: "pending",
      }).onConflictDoNothing();
      return "applied" as const;
    });
  }
}
