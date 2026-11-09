import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentProviderError, WebhookRejectedError, type CreateSubscriptionInput, type CustomerInput, type PaymentEvent, type PaymentProvider, type ProviderCapabilities, type ProviderSubscription } from "@/domain/subscription/payment-provider";

type Offer = { offerId: string; productId: string; checkoutUrl: string; amountMinor: number; interval: "month" | "year" };
const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cakto hosted-checkout adapter. The checkout is created in the seller's account.
 * The opaque Command subscription UUID travels as ?callback= and is returned in
 * signed webhooks. No customer payment information is trusted for tenant scope.
 *
 * A provider-side recurring cancellation needs its own documented/API-controlled
 * implementation; until then cancellation fails closed (no false local cancel).
 */
export class CaktoPaymentProvider implements PaymentProvider {
  readonly id = "cakto";
  readonly currencies = ["BRL"] as const;
  readonly capabilities: ProviderCapabilities = { billingMode: "provider_recurring", methods: ["pix", "card"], refunds: false };
  private readonly offers: Offer[];
  constructor(private readonly env: Record<string, string | undefined> = process.env, private readonly now: () => Date = () => new Date()) {
    if (!env.FMCC_CAKTO_WEBHOOK_SECRET || env.FMCC_CAKTO_WEBHOOK_SECRET.length < 24) throw new Error("cakto.webhook_secret_required");
    let parsed: unknown;
    try { parsed = JSON.parse(env.FMCC_CAKTO_CHECKOUTS_JSON ?? ""); } catch { throw new Error("cakto.checkout_config_invalid"); }
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("cakto.checkout_config_invalid");
    this.offers = parsed.map((item: unknown) => {
      const a = item as Partial<Offer>;
      if (!a || typeof a.offerId !== "string" || !/^[A-Za-z0-9_-]{3,90}$/.test(a.offerId) ||
          typeof a.productId !== "string" || !/^[A-Za-z0-9_-]{3,90}$/.test(a.productId) ||
          !Number.isSafeInteger(a.amountMinor) || (a.amountMinor ?? 0) < 500 ||
          !["month", "year"].includes(a.interval ?? "") || typeof a.checkoutUrl !== "string") throw new Error("cakto.checkout_config_invalid");
      let url: URL;
      try { url = new URL(a.checkoutUrl); } catch { throw new Error("cakto.checkout_config_invalid"); }
      if (url.protocol !== "https:" || url.hostname !== "pay.cakto.com.br" || url.username || url.password ||
          url.searchParams.has("callback") || url.hash) throw new Error("cakto.checkout_config_invalid");
      return {offerId: a.offerId, productId: a.productId, amountMinor: a.amountMinor!, interval: a.interval!, checkoutUrl: url.toString()};
    });
    if (new Set(this.offers.map(x => x.offerId)).size !== this.offers.length) throw new Error("cakto.checkout_config_duplicate");
  }

  async createCustomer(input: CustomerInput): Promise<{ customerRef: string }> {
    if (!REF.test(input.externalReference)) throw new PaymentProviderError("cakto.reference_invalid", "rejected");
    // Customer details are collected by Cakto's hosted checkout; never send PAN/CPF to Command.
    return { customerRef: input.externalReference };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription> {
    if (!REF.test(input.externalReference) || input.price.currency !== "BRL") throw new PaymentProviderError("cakto.reference_invalid", "rejected");
    const matches = this.offers.filter(x => x.amountMinor === input.price.amountMinor && x.interval === input.interval);
    if (matches.length !== 1) throw new PaymentProviderError("cakto.offer_not_configured_or_ambiguous", "rejected");
    const url = new URL(matches[0].checkoutUrl);
    url.searchParams.set("callback", input.externalReference);
    // Idempotent: no provider mutation; reissuing an identical checkout URL is safe.
    return { subscriptionRef: input.externalReference, checkoutUrl: url.toString() };
  }

  async findSubscriptionByReference(reference: string): Promise<ProviderSubscription | null> {
    // This adapter never creates a remote subscription by POST. No remote recovery needed.
    void reference;
    return null;
  }

  async cancelSubscription(_subscriptionRef: string): Promise<void> {
    // Never say "cancelled" until cancellation has been acknowledged by Cakto.
    throw new PaymentProviderError("cakto.cancel_requires_provider_confirmation", "rejected");
  }

  verifyWebhook(headers: Headers, rawBody: string): PaymentEvent | null {
    const secret = this.env.FMCC_CAKTO_WEBHOOK_SECRET;
    if (!secret || secret.length < 24) throw new WebhookRejectedError("webhook.not_configured");
    const timestamp = headers.get("x-cakto-timestamp") ?? "";
    const signature = headers.get("x-cakto-signature") ?? "";
    if (!/^\d{10}$/.test(timestamp) || !/^v1=[0-9a-f]{64}$/i.test(signature) ||
        Math.abs(this.now().getTime() / 1000 - Number(timestamp)) > 300) throw new WebhookRejectedError("webhook.signature_invalid");
    const expected = "v1=" + createHmac("sha256", secret).update(timestamp + ".").update(rawBody).digest("hex");
    if (!timingSafeEqual(Buffer.from(signature.toLowerCase()), Buffer.from(expected))) throw new WebhookRejectedError("webhook.signature_invalid");
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { throw new WebhookRejectedError("webhook.body_invalid"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WebhookRejectedError("webhook.body_invalid");
    const envelope = body as Record<string, unknown>;
    if (typeof envelope.event !== "string") throw new WebhookRejectedError("webhook.body_invalid");
    // V2 can send multiple orders; accept only independently validated main items.
    const records = Array.isArray(envelope.data) ? envelope.data : [envelope.data];
    if (records.length !== 1) return null; // batch requires its own atomic processing; never pick first arbitrarily
    const order = records[0];
    if (!order || typeof order !== "object" || Array.isArray(order)) return null;
    const data = order as Record<string, unknown>;
    if (data.offer_type !== "main" || !REF.test(String(data.callback ?? "")) ||
        typeof data.id !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(data.id)) return null;
    const offer = data.offer as { id?: unknown } | undefined;
    const product = data.product as { id?: unknown } | undefined;
    const matched = this.offers.find(x => x.offerId === offer?.id && x.productId === product?.id);
    if (!matched || data.currency !== "BRL") return null;
    const event = envelope.event;
    const monetary = typeof data.amount === "number" && Number.isFinite(data.amount) && data.amount >= 0
      ? Math.round(data.amount * 100) : null;
    // Never activate a wrong-price offer, even from a correctly signed webhook.
    const isPaid = event === "purchase_approved" || event === "subscription_renewed" || event === "subscription_late_recovered";
    if (isPaid && (data.status !== "paid" || monetary !== matched.amountMinor)) return null;
    const type: PaymentEvent["type"] | null =
      isPaid ? "payment_confirmed" :
      ["subscription_late", "subscription_renewal_refused"].includes(event) ? "payment_overdue" :
      ["refund", "chargeback"].includes(event) ? "payment_refunded" :
      event === "subscription_canceled" ? "subscription_cancelled" : null;
    if (!type) return null;
    const dateStr = type === "payment_confirmed" ? data.paidAt : type === "payment_refunded" ? (data.refundedAt ?? data.chargedbackAt) : data.createdAt;
    const occurredAt = typeof dateStr === "string" && Number.isFinite(Date.parse(dateStr)) ? new Date(dateStr) : this.now();
    // Two payment-success events for the same order are one cycle, never two.
    const tag = type === "payment_confirmed" ? "pay" : type === "payment_overdue" ? "late" : type === "payment_refunded" ? "refund" : "cancel";
    return {eventId: tag + ":" + data.id, type, subscriptionRef: data.callback as string,
      paymentRef: data.id, amount: type === "payment_confirmed" ? { amountMinor: monetary!, currency: "BRL" } : null, occurredAt};
  }
}
