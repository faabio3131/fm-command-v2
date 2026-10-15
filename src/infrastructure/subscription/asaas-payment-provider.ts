import { timingSafeEqual } from "node:crypto";
import { resolveGatewaySecret, ASAAS_SANDBOX_SECRET_REF } from "@/infrastructure/billing/secret-resolver";
import { PaymentProviderError, WebhookRejectedError, type CreateSubscriptionInput, type CustomerInput, type PaymentEvent, type PaymentProvider, type ProviderSubscription } from "@/domain/subscription/payment-provider";

const SANDBOX_BASE = "https://api-sandbox.asaas.com/v3";
const ENDPOINT = /^\/(customers|subscriptions)(\/[A-Za-z0-9_-]{1,64})?(\?externalReference=[A-Za-z0-9_-]{1,64}&limit=1)?$/;

/**
 * Asaas como UM provedor do contrato (ADR-021). Somente SANDBOX nesta etapa: nao existe caminho de producao no codigo, de proposito,
 * ate o Diretor decidir (conta, chaves e primeiro cliente). BRL apenas. Escrito a partir da documentacao e do cliente de sandbox da V1;
 * NAO foi exercitado contra a API real (nao ha conta de teste desta etapa) - testado so com transporte simulado.
 * Nunca repete POST as cegas: resposta incerta vira PaymentProviderError "uncertain" e a recuperacao procura pela nossa referencia.
 */
export class AsaasPaymentProvider implements PaymentProvider {
  readonly id = "asaas";
  readonly currencies = ["BRL"] as const;
  constructor(private readonly opts: { transport?: typeof fetch; env?: Record<string, string | undefined>; now?: () => Date } = {}) {}
  private get env() { return this.opts.env ?? process.env; }

  private async request<T>(method: "GET" | "POST" | "DELETE", endpoint: string, body?: object): Promise<T> {
    if (!ENDPOINT.test(endpoint)) throw new PaymentProviderError("asaas.endpoint_denied", "rejected");
    const token = resolveGatewaySecret({ provider: "asaas", environment: "sandbox", secretRef: ASAAS_SANDBOX_SECRET_REF }, this.env);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await (this.opts.transport ?? fetch)(SANDBOX_BASE + endpoint, {
        method, signal: controller.signal, redirect: "error", cache: "no-store",
        headers: { access_token: token, accept: "application/json", "content-type": "application/json", "user-agent": "FMCommand-SaaS/1.0" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const transient = res.status === 429 || res.status >= 500;
        throw new PaymentProviderError(`asaas.http_${res.status}`, !transient ? "rejected" : method === "GET" ? "transient" : "uncertain");
      }
      const data: unknown = await res.json();
      if (!data || typeof data !== "object") throw new PaymentProviderError("asaas.invalid_response", "uncertain");
      return data as T;
    } catch (e) {
      if (e instanceof PaymentProviderError) throw e;
      throw new PaymentProviderError("asaas.transport_failure", method === "GET" ? "transient" : "uncertain");
    } finally { clearTimeout(timer); }
  }

  async createCustomer(input: CustomerInput): Promise<{ customerRef: string }> {
    if (!input.taxId) throw new PaymentProviderError("asaas.tax_id_required", "rejected"); // Asaas exige CPF/CNPJ do pagador
    const c = await this.request<{ id?: unknown }>("POST", "/customers", { name: input.name, email: input.email, cpfCnpj: input.taxId, externalReference: input.externalReference });
    if (typeof c.id !== "string") throw new PaymentProviderError("asaas.invalid_response", "uncertain");
    return { customerRef: c.id };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription> {
    if (input.price.currency !== "BRL") throw new PaymentProviderError("asaas.currency_unsupported", "rejected");
    const s = await this.request<{ id?: unknown }>("POST", "/subscriptions", {
      customer: input.customerRef, billingType: "UNDEFINED", value: input.price.amountMinor / 100, nextDueDate: input.firstDueDate,
      cycle: input.interval === "month" ? "MONTHLY" : "YEARLY", description: input.description, externalReference: input.externalReference,
    });
    if (typeof s.id !== "string") throw new PaymentProviderError("asaas.invalid_response", "uncertain");
    return { subscriptionRef: s.id, checkoutUrl: null };
  }

  async findSubscriptionByReference(externalReference: string): Promise<ProviderSubscription | null> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(externalReference)) return null;
    const r = await this.request<{ data?: Array<{ id?: unknown; externalReference?: unknown }> }>("GET", `/subscriptions?externalReference=${externalReference}&limit=1`);
    const hit = r.data?.find((x) => x.externalReference === externalReference && typeof x.id === "string");
    return hit ? { subscriptionRef: hit.id as string, checkoutUrl: null } : null;
  }

  async cancelSubscription(subscriptionRef: string): Promise<void> {
    await this.request("DELETE", `/subscriptions/${subscriptionRef}`);
  }

  /**
   * Autentica pelo token configurado no painel do Asaas (cabecalho asaas-access-token), em tempo constante.
   * O identificador do evento e derivado do PAGAMENTO, nao do evento: Asaas pode enviar CONFIRMED e depois RECEIVED para o mesmo pagamento,
   * e isso nao pode estender o periodo duas vezes.
   */
  verifyWebhook(headers: Headers, rawBody: string): PaymentEvent | null {
    const expected = this.env.FMCC_ASAAS_SAAS_WEBHOOK_TOKEN;
    if (!expected || expected.length < 16) throw new WebhookRejectedError("webhook.not_configured");
    const got = headers.get("asaas-access-token") ?? "";
    if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) throw new WebhookRejectedError("webhook.signature_invalid");
    let o: { event?: unknown; payment?: Record<string, unknown>; subscription?: Record<string, unknown> };
    try { o = JSON.parse(rawBody); } catch { throw new WebhookRejectedError("webhook.body_invalid"); }
    if (!o || typeof o.event !== "string") throw new WebhookRejectedError("webhook.body_invalid");
    const now = (this.opts.now ?? (() => new Date()))();
    const p = o.payment;
    const payEvent = (type: PaymentEvent["type"], tag: string): PaymentEvent | null => {
      if (!p || typeof p.id !== "string" || typeof p.subscription !== "string") return null; // cobranca avulsa: nao e nossa
      const value = typeof p.value === "number" && Number.isFinite(p.value) ? Math.round(p.value * 100) : null;
      return { eventId: `${tag}:${p.id}`, type, subscriptionRef: p.subscription, paymentRef: p.id, amount: value !== null && type === "payment_confirmed" ? { amountMinor: value, currency: "BRL" } : null, occurredAt: now };
    };
    switch (o.event) {
      case "PAYMENT_CONFIRMED": case "PAYMENT_RECEIVED": return payEvent("payment_confirmed", "pay");
      case "PAYMENT_OVERDUE": return payEvent("payment_overdue", "ovd");
      case "PAYMENT_REFUNDED": return payEvent("payment_refunded", "ref");
      case "SUBSCRIPTION_DELETED": case "SUBSCRIPTION_INACTIVATED": {
        const s = o.subscription;
        if (!s || typeof s.id !== "string") return null;
        return { eventId: `sub:${s.id}:ended`, type: "subscription_cancelled", subscriptionRef: s.id, paymentRef: null, amount: null, occurredAt: now };
      }
      default: return null;
    }
  }
}
