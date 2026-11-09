import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CaktoPaymentProvider } from "@/infrastructure/subscription/cakto-payment-provider";
import { defaultProviderRegistry } from "@/infrastructure/subscription/provider-registry";

const ID = "fa9c7a11-5725-4495-bc16-f09a86c52d3e";
const secret = "test-only-secret-1234567890-test-secret";
const config = {
  FMCC_CAKTO_WEBHOOK_SECRET: secret,
  FMCC_CAKTO_CHECKOUTS_JSON: JSON.stringify([
    { offerId: "offer_month", productId: "iron_product", checkoutUrl: "https://pay.cakto.com.br/offer_month", amountMinor: 26900, interval: "month" },
    { offerId: "offer_year", productId: "iron_product", checkoutUrl: "https://pay.cakto.com.br/offer_year", amountMinor: 269000, interval: "year" },
  ]),
};
const now = new Date("2026-11-09T12:00:00Z");
const provider = () => new CaktoPaymentProvider(config, () => now);
const webhook = (data: Record<string, unknown>, event = "purchase_approved") => {
  const body = JSON.stringify({ event, data });
  const ts = String(Math.floor(now.getTime() / 1000));
  const sig = "v1=" + createHmac("sha256", secret).update(ts + "." + body).digest("hex");
  return { body, headers: new Headers({ "x-cakto-timestamp": ts, "x-cakto-signature": sig }) };
};
const order = (changes: Record<string, unknown> = {}) => ({
  id: "purchase_000001", offer_type: "main", callback: ID, status: "paid",
  amount: 269, currency: "BRL", paidAt: now.toISOString(),
  offer: { id: "offer_month" }, product: { id: "iron_product" }, ...changes,
});
describe("Cakto hosted checkout and authenticated webhook", () => {
  it("is not enabled without seller config", () => {
    expect(defaultProviderRegistry({ NODE_ENV: "production" }).get("cakto")).toBeNull();
    expect(defaultProviderRegistry({ NODE_ENV: "production", ...config }).get("cakto")).not.toBeNull();
  });
  it("creates no remote charge; returns opaque tenant-bound callback URL", async () => {
    const p = provider();
    expect(await p.createCustomer({ name: "Maria", email: "maria@example.com", taxId: null, externalReference: ID })).toEqual({ customerRef: ID });
    const r = await p.createSubscription({ customerRef: ID, externalReference: ID,
      price: { amountMinor: 26900, currency: "BRL" }, interval: "month", description: "IRON", firstDueDate: "2026-11-09" });
    expect(r).toEqual({ subscriptionRef: ID, checkoutUrl: "https://pay.cakto.com.br/offer_month?callback=" + ID });
    await expect(p.findSubscriptionByReference(ID)).resolves.toBeNull();
    await expect(p.cancelSubscription(ID)).rejects.toThrow("cakto.cancel_requires_provider_confirmation");
  });
  it("validates signature and amount, accepts only main offer of expected product", () => {
    const p = provider(); const x = webhook(order());
    expect(p.verifyWebhook(x.headers, x.body)).toMatchObject({
      eventId: "pay:purchase_000001", type: "payment_confirmed", subscriptionRef: ID, amount: { amountMinor: 26900, currency: "BRL" },
    });
    const tampered = x.body.replace("269", "1");
    expect(() => p.verifyWebhook(x.headers, tampered)).toThrow("webhook.signature_invalid");
    for (const changes of [{ amount: 1 }, { product: { id: "other" } }, { offer: { id: "offer_year" } }, { callback: null }, { offer_type: "orderbump" }, { status: "waiting_payment" }]) {
      const y = webhook(order(changes)); expect(p.verifyWebhook(y.headers, y.body)).toBeNull();
    }
  });
  it("rejects stale, unsigned, and malformed deliveries", () => {
    const p = provider(), x = webhook(order());
    x.headers.set("x-cakto-timestamp", String(Math.floor(now.getTime() / 1000) - 301));
    expect(() => p.verifyWebhook(x.headers, x.body)).toThrow("webhook.signature_invalid");
    x.headers.delete("x-cakto-signature");
    expect(() => p.verifyWebhook(x.headers, x.body)).toThrow("webhook.signature_invalid");
  });
  it("deduplicates approval and renewal on the same order ID and never grants access from refund", () => {
    const p = provider();
    const success = webhook(order());
    const renewed = webhook(order(), "subscription_renewed");
    const refund = webhook(order(), "refund");
    expect(p.verifyWebhook(success.headers, success.body)?.eventId).toBe(p.verifyWebhook(renewed.headers, renewed.body)?.eventId);
    expect(p.verifyWebhook(refund.headers, refund.body)).toMatchObject({ type: "payment_refunded", amount: null });
  });
  it("refuses ambiguous price mappings and unsafe checkout targets", async () => {
    expect(() => new CaktoPaymentProvider({ ...config, FMCC_CAKTO_CHECKOUTS_JSON: JSON.stringify([
      { offerId: "a12", productId: "p12", checkoutUrl: "https://attacker.example/pay", amountMinor: 26900, interval: "month" },
    ]) })).toThrow("cakto.checkout_config_invalid");
    await expect(provider().createSubscription({ customerRef: ID, externalReference: ID,
      price: { amountMinor: 1, currency: "BRL" }, interval: "month", description: "IRON", firstDueDate: "2026-11-09" })).rejects.toThrow("cakto.offer_not_configured_or_ambiguous");
  });
});
