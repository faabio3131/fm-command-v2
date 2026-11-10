import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { CaktoPaymentProvider } from "@/infrastructure/subscription/cakto-payment-provider";
import { db } from "@/infrastructure/db/client";
import { billingGatewayAccounts, billingGatewayEvents, billingInvoices, billingIronEntitlementOutbox, billingProductPlans, billingProviderPayments, billingSubscriptions } from "@/infrastructure/db/billing-schema";

/** Pure Gregorian-UTC month/year addition with end-of-month clamping. */
export function advanceIronPaidCycle(start: Date, interval: "monthly" | "yearly"): Date {
  if (!Number.isFinite(start.getTime()) || !["monthly", "yearly"].includes(interval))
    throw new Error("cakto.period_invalid");
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (interval === "monthly" ? 1 : 12));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

/** The Command product ledger, never the academy-to-student financial subsystem. */
export class CaktoIronProductBilling {
  private readonly tenantId: string;
  private readonly productId: string;
  private readonly provider: CaktoPaymentProvider;

  constructor(private readonly env: Record<string, string | undefined> = process.env) {
    this.tenantId = env.FMCC_IRON_BILLING_TENANT_ID ?? "";
    this.productId = env.FMCC_IRON_PRODUCT_ID ?? "";
    if (!/^[A-Za-z0-9._:-]{3,128}$/.test(this.tenantId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.productId))
      throw new Error("cakto.iron_scope_not_configured");
    this.provider = new CaktoPaymentProvider(env);
  }

  private async boundInvoice(invoiceId: string) {
    const rows = await db.select({
      invoice: billingInvoices, subscription: billingSubscriptions,
      gateway: billingGatewayAccounts, plan: billingProductPlans,
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
    // Signed events for already-paid invoices still require reconciliation when
    // the commercial plan or gateway is retired. Their original invoice amount
    // and verified offer binding, not the current price, remain authoritative.
    if (!r || r.gateway.provider !== "cakto" || r.gateway.environment !== "production" ||
      r.invoice.currency !== "BRL")
      throw new Error("cakto.invoice_binding_not_ready");
    return r;
  }

  /** Only an authenticated/prepared canonical invoice may enter a real Cakto checkout. */
  async checkoutUrl(invoiceId: string): Promise<string> {
    if (this.env.FMCC_IRON_COMMERCIAL_SALES_ENABLED !== "true")
      throw new Error("cakto.iron_sales_not_authorized");
    const r = await this.boundInvoice(invoiceId);
    // Only NEW checkouts require the plan, gateway and current price to be live.
    if (r.gateway.status !== "enabled" || r.plan.status !== "active" ||
        r.invoice.amountMinor !== r.plan.amountMinor)
      throw new Error("cakto.invoice_binding_not_ready");
    if (r.invoice.status !== "pending" || r.subscription.status !== "pending")
      throw new Error("cakto.invoice_not_pending");
    const interval = r.plan.interval === "monthly" ? "month" : r.plan.interval === "yearly" ? "year" : null;
    if (!interval) throw new Error("cakto.invoice_interval_invalid");
    const result = await this.provider.createSubscription({
      customerRef: r.invoice.customerId, externalReference: invoiceId,
      price: { amountMinor: r.invoice.amountMinor, currency: "BRL" },
      interval, description: "IRON FIT CORE - " + r.plan.planCode,
      firstDueDate: new Date().toISOString().slice(0, 10),
    });
    if (!result.checkoutUrl) throw new Error("cakto.checkout_not_available");
    return result.checkoutUrl;
  }

  /** Authenticates raw signed notification, reconciles one invoice/cycle and enqueues license changes atomically. */
  async handleWebhook(headers: Headers, raw: string): Promise<"applied" | "duplicate" | "ignored" | "unmatched"> {
    const event = this.provider.verifyWebhook(headers, raw);
    const paymentRef = event?.paymentRef;
    if (!event || !paymentRef || !/^[A-Za-z0-9_-]{6,128}$/.test(paymentRef)) return "ignored";
    // Provider-specific event remains inside the verified provider boundary.
    const sourceEvent = (JSON.parse(raw) as { event?: string }).event;
    const accepted = ["purchase_approved", "subscription_renewed", "refund", "chargeback",
      "subscription_canceled", "subscription_late", "subscription_renewal_refused"];
    if (!sourceEvent || !accepted.includes(sourceEvent)) return "ignored";
    let binding: Awaited<ReturnType<typeof this.boundInvoice>>;
    try { binding = await this.boundInvoice(event.subscriptionRef); }
    catch { return "unmatched"; } // No trust in email/CPF/redirect/unknown invoice.
    if (event.type === "payment_confirmed" && (!event.amount ||
      event.amount.currency !== "BRL" || event.amount.amountMinor !== binding.invoice.amountMinor)) return "ignored";
    const interval = binding.plan.interval === "monthly" ? "month" :
      binding.plan.interval === "yearly" ? "year" : null;
    if (!interval || !this.provider.matchesRecurringOffer(raw, binding.invoice.amountMinor, interval))
      return "ignored";

    return db.transaction(async (tx) => {
      // Anchor is the FIRST, pre-authorized checkout invoice ID from Cakto's sck.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${event.subscriptionRef}, 0))`);
      const [subscription] = await tx.select().from(billingSubscriptions).where(and(
        eq(billingSubscriptions.tenantId, this.tenantId),
        eq(billingSubscriptions.productId, this.productId),
        eq(billingSubscriptions.id, binding.subscription.id),
      )).for("update").limit(1);
      if (!subscription || subscription.customerId !== binding.invoice.customerId)
        throw new Error("cakto.subscription_scope_changed");
      const [anchor] = await tx.select().from(billingInvoices).where(and(
        eq(billingInvoices.tenantId, this.tenantId),
        eq(billingInvoices.id, binding.invoice.id),
        eq(billingInvoices.subscriptionId, subscription.id),
      )).for("update").limit(1);
      if (!anchor || anchor.gatewayAccountId !== binding.gateway.id)
        throw new Error("cakto.anchor_invoice_changed");

      const isPayment = event.type === "payment_confirmed";
      const isRefund = event.type === "payment_refunded";
      const isLate = event.type === "payment_overdue";
      const isCancel = event.type === "subscription_cancelled";
      if (isPayment && subscription.status === "cancelled")
        throw new Error("cakto.cancelled_subscription_cannot_reactivate");
      if (isPayment && sourceEvent === "purchase_approved" && !(anchor.status === "pending" && subscription.status === "pending"))
        return "duplicate" as const;
      if (isPayment && sourceEvent === "subscription_renewed" &&
        !(anchor.status === "paid" && ["active", "past_due"].includes(subscription.status) && subscription.paidThrough))
        throw new Error("cakto.renewal_without_confirmed_initial_cycle");

      // The gateway event is immutable and scoped to FM-owned account, no raw payload or PII.
      const [receipt] = await tx.insert(billingGatewayEvents).values({
        tenantId: this.tenantId, gatewayAccountId: binding.gateway.id,
        externalEventId: "cakto:" + event.type + ":" + paymentRef,
        status: "processed", eventType: event.type, externalPaymentId: paymentRef,
        externalReference: event.subscriptionRef,
        payloadFingerprint: createHash("sha256").update(raw).digest("hex"),
        processedAt: new Date(),
      }).onConflictDoNothing().returning({ id: billingGatewayEvents.id });
      if (!receipt) return "duplicate" as const;

      if (isPayment) {
        const base = subscription.paidThrough && subscription.paidThrough > event.occurredAt
          ? subscription.paidThrough : event.occurredAt;
        const periodEnd = advanceIronPaidCycle(base, binding.plan.interval as "monthly" | "yearly");
        const invoiceId = sourceEvent === "purchase_approved" ? anchor.id :
          (await tx.insert(billingInvoices).values({
            tenantId: this.tenantId, productId: this.productId,
            customerId: anchor.customerId, subscriptionId: anchor.subscriptionId,
            gatewayAccountId: anchor.gatewayAccountId, currency: "BRL",
            amountMinor: anchor.amountMinor, status: "paid", periodEnd,
          }).returning({ id: billingInvoices.id }))[0].id;
        const [payment] = await tx.insert(billingProviderPayments).values({
          tenantId: this.tenantId, invoiceId,
          gatewayAccountId: binding.gateway.id, externalPaymentId: paymentRef,
          status: "received",
        }).onConflictDoNothing().returning({ id: billingProviderPayments.id });
        if (!payment) throw new Error("cakto.payment_identity_conflict");
        if (sourceEvent === "purchase_approved") {
          await tx.update(billingInvoices).set({ status: "paid", periodEnd })
            .where(and(eq(billingInvoices.tenantId, this.tenantId), eq(billingInvoices.id, invoiceId)));
        }
        await tx.update(billingSubscriptions).set({ status: "active", paidThrough: periodEnd })
          .where(and(eq(billingSubscriptions.tenantId, this.tenantId), eq(billingSubscriptions.id, subscription.id)));
        await tx.insert(billingIronEntitlementOutbox).values({
          tenantId: this.tenantId, productId: this.productId, invoiceId,
          subscriptionId: subscription.id, eventType: "LICENSE_ACTIVATE",
          idempotencyKey: "cakto:paid:" + paymentRef, status: "pending",
        }).onConflictDoNothing();
        return "applied" as const;
      }

      if (isRefund) {
        // Must identify EXACT payment; refund of an older cycle cannot revoke a newer paid term.
        const [payment] = await tx.select().from(billingProviderPayments).where(and(
          eq(billingProviderPayments.tenantId, this.tenantId),
          eq(billingProviderPayments.gatewayAccountId, binding.gateway.id),
          eq(billingProviderPayments.externalPaymentId, paymentRef),
        )).for("update").limit(1);
        if (!payment || payment.status !== "received") throw new Error("cakto.refund_payment_not_found");
        const [affected] = await tx.select().from(billingInvoices).where(and(
          eq(billingInvoices.tenantId, this.tenantId),
          eq(billingInvoices.id, payment.invoiceId),
          eq(billingInvoices.subscriptionId, subscription.id),
        )).for("update").limit(1);
        if (!affected || affected.status !== "paid") throw new Error("cakto.refund_invoice_mismatch");
        await tx.update(billingProviderPayments).set({ status: "refunded" }).where(eq(billingProviderPayments.id, payment.id));
        await tx.update(billingInvoices).set({ status: "refunded" })
          .where(and(eq(billingInvoices.tenantId, this.tenantId), eq(billingInvoices.id, affected.id)));
        if (affected.periodEnd && subscription.paidThrough &&
            affected.periodEnd.getTime() === subscription.paidThrough.getTime()) {
          await tx.update(billingSubscriptions).set({ status: "past_due" })
            .where(and(eq(billingSubscriptions.tenantId, this.tenantId), eq(billingSubscriptions.id, subscription.id)));
          await tx.insert(billingIronEntitlementOutbox).values({
            tenantId: this.tenantId, productId: this.productId,
            invoiceId: affected.id, subscriptionId: subscription.id,
            eventType: "LICENSE_SUSPEND", idempotencyKey: "cakto:refund:" + paymentRef,
          }).onConflictDoNothing();
        }
        return "applied" as const;
      }

      const [latestPaid] = await tx.select().from(billingInvoices).where(and(
        eq(billingInvoices.tenantId, this.tenantId),
        eq(billingInvoices.subscriptionId, subscription.id),
        eq(billingInvoices.status, "paid"),
      )).orderBy(desc(billingInvoices.createdAt)).limit(1);
      if (!latestPaid) return "ignored" as const;
      if (isLate && ["active", "past_due"].includes(subscription.status)) {
        await tx.update(billingSubscriptions).set({ status: "past_due" })
          .where(and(eq(billingSubscriptions.tenantId, this.tenantId), eq(billingSubscriptions.id, subscription.id)));
        const graceDays = this.env.FMCC_IRON_GRACE_DAYS === undefined ? 3 : Number(this.env.FMCC_IRON_GRACE_DAYS);
        if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 30) throw new Error("cakto.grace_config_invalid");
        const limit = subscription.paidThrough?.getTime() ?? Date.now();
        await tx.insert(billingIronEntitlementOutbox).values({
          tenantId: this.tenantId, productId: this.productId,
          invoiceId: latestPaid.id, subscriptionId: subscription.id,
          eventType: "LICENSE_SUSPEND",
          idempotencyKey: "cakto:overdue:" + paymentRef,
          availableAt: new Date(Math.max(Date.now(), limit + graceDays * 86_400_000)),
        }).onConflictDoNothing();
        return "applied" as const;
      }
      if (isCancel && ["active", "past_due"].includes(subscription.status)) {
        await tx.update(billingSubscriptions).set({ status: "cancelled" })
          .where(and(eq(billingSubscriptions.tenantId, this.tenantId), eq(billingSubscriptions.id, subscription.id)));
        await tx.insert(billingIronEntitlementOutbox).values({
          tenantId: this.tenantId, productId: this.productId,
          invoiceId: latestPaid.id, subscriptionId: subscription.id,
          eventType: "LICENSE_CANCEL",
          idempotencyKey: "cakto:cancel:" + paymentRef,
          availableAt: new Date(Math.max(Date.now(), subscription.paidThrough?.getTime() ?? Date.now())),
        }).onConflictDoNothing();
        return "applied" as const;
      }
      return "ignored" as const;
    });
  }
}
