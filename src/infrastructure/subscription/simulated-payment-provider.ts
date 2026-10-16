import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PaymentProviderError, WebhookRejectedError, type CreateSubscriptionInput, type CustomerInput, type PaymentEvent, type PaymentEventType, type PaymentProvider, type ProviderCapabilities, type ProviderSubscription } from "@/domain/subscription/payment-provider";

export type SimFault = "none" | "transient" | "rejected" | "uncertain_after_create";

/**
 * Meio de cobranca SIMULADO (ADR-021): nao fala com ninguem, nao cobra ninguem. Existe para provar o contrato, o ciclo de vida e a troca de
 * provedor por configuracao. So e registrado quando FMCC_PAYMENT_SIMULATED=1. Aceita falhas programadas para testar recuperacao.
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly currencies: readonly string[];
  readonly capabilities: ProviderCapabilities;
  fault: SimFault = "none";
  readonly subscriptions = new Map<string, { externalReference: string; cancelled: boolean; price: CreateSubscriptionInput["price"] }>();
  calls = { createCustomer: 0, createSubscription: 0, find: 0, cancel: 0 };
  private seq = 0;

  constructor(readonly id: string, private readonly webhookSecret: string, currencies: readonly string[] = ["BRL", "USD", "EUR"],
    capabilities: ProviderCapabilities = { billingMode: "provider_recurring", methods: ["boleto", "pix", "card", "transfer", "other"], refunds: true }) {
    this.currencies = currencies;
    this.capabilities = capabilities;
  }

  async createCustomer(input: CustomerInput): Promise<{ customerRef: string }> {
    this.calls.createCustomer++;
    if (!input.name || !input.email) throw new PaymentProviderError("sim.customer_invalid", "rejected");
    return { customerRef: `${this.id}_cus_${++this.seq}` };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription> {
    this.calls.createSubscription++;
    if (this.fault === "transient") throw new PaymentProviderError("sim.unavailable", "transient");
    if (this.fault === "rejected") throw new PaymentProviderError("sim.rejected", "rejected");
    const ref = `${this.id}_sub_${++this.seq}`;
    this.subscriptions.set(ref, { externalReference: input.externalReference, cancelled: false, price: input.price });
    if (this.fault === "uncertain_after_create") throw new PaymentProviderError("sim.response_lost", "uncertain");
    return { subscriptionRef: ref, checkoutUrl: null };
  }

  async findSubscriptionByReference(externalReference: string): Promise<ProviderSubscription | null> {
    this.calls.find++;
    for (const [ref, s] of this.subscriptions) if (s.externalReference === externalReference) return { subscriptionRef: ref, checkoutUrl: null };
    return null;
  }

  async cancelSubscription(subscriptionRef: string): Promise<void> {
    this.calls.cancel++;
    if (this.fault === "transient") throw new PaymentProviderError("sim.unavailable", "transient");
    const s = this.subscriptions.get(subscriptionRef);
    if (!s) throw new PaymentProviderError("sim.subscription_not_found", "rejected");
    s.cancelled = true;
  }

  sign(body: string): string { return createHmac("sha256", this.webhookSecret).update(body).digest("hex"); }

  /** Monta o corpo e o cabecalho que o "provedor" enviaria; usado pelos testes e pela prova. */
  makeWebhook(e: { eventId: string; type: PaymentEventType; subscriptionRef: string; amountMinor?: number; currency?: string; occurredAt?: Date }): { body: string; headers: Headers } {
    const body = JSON.stringify({ eventId: e.eventId, type: e.type, subscriptionRef: e.subscriptionRef, amountMinor: e.amountMinor ?? null, currency: e.currency ?? null, occurredAt: (e.occurredAt ?? new Date()).toISOString() });
    return { body, headers: new Headers({ "x-sim-signature": this.sign(body) }) };
  }

  verifyWebhook(headers: Headers, rawBody: string): PaymentEvent | null {
    const got = headers.get("x-sim-signature") ?? "";
    const want = this.sign(rawBody);
    if (!sameSecret(got, want)) throw new WebhookRejectedError("webhook.signature_invalid");
    let o: Record<string, unknown>;
    try { o = JSON.parse(rawBody) as Record<string, unknown>; } catch { throw new WebhookRejectedError("webhook.body_invalid"); }
    const types: PaymentEventType[] = ["payment_confirmed", "payment_overdue", "payment_refunded", "subscription_cancelled"];
    if (typeof o.eventId !== "string" || typeof o.subscriptionRef !== "string" || !types.includes(o.type as PaymentEventType)) throw new WebhookRejectedError("webhook.body_invalid");
    const at = new Date(String(o.occurredAt));
    if (Number.isNaN(at.getTime())) throw new WebhookRejectedError("webhook.body_invalid");
    const amount = Number.isSafeInteger(o.amountMinor) && typeof o.currency === "string" ? { amountMinor: o.amountMinor as number, currency: o.currency } : null;
    return { eventId: o.eventId, type: o.type as PaymentEventType, subscriptionRef: o.subscriptionRef, paymentRef: null, amount, occurredAt: at };
  }
}

/** Compara por hash: comprimento e bytes nao vazam e caracteres fora do ASCII nao derrubam a comparacao. */
function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
