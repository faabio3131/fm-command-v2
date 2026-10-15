import { describe, expect, it } from "vitest";
import { AsaasPaymentProvider } from "@/infrastructure/subscription/asaas-payment-provider";
import { defaultProviderRegistry } from "@/infrastructure/subscription/provider-registry";
import { PaymentProviderError, WebhookRejectedError } from "@/domain/subscription/payment-provider";

const KEY = "chave-sandbox-so-no-teste";
const TOKEN = "token-de-webhook-com-mais-de-16";
const env = { FMCC_ASAAS_SANDBOX_API_KEY: KEY, FMCC_ASAAS_SAAS_WEBHOOK_TOKEN: TOKEN };
const NOW = new Date("2026-03-10T12:00:00Z");

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }
function transport(handler: (c: Call) => { status?: number; json?: unknown } | "boom") {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const c: Call = { url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = handler(c);
    if (r === "boom") throw new TypeError("rede");
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const provider = (t: ReturnType<typeof transport>) => new AsaasPaymentProvider({ transport: t.fn, env, now: () => NOW });
const sub = { customerRef: "cus_1", price: { amountMinor: 4900, currency: "BRL" }, interval: "month" as const, externalReference: "11111111-1111-1111-1111-111111111111", description: "FM Command - Pro", firstDueDate: "2026-03-10" };

describe("Asaas (sandbox) como provedor do contrato", () => {
  it("cria cliente e assinatura mensal com valor decimal, so no host de sandbox e com a chave no cabecalho", async () => {
    const t = transport((c) => ({ json: c.url.endsWith("/customers") ? { id: "cus_1" } : { id: "sub_1" } }));
    const p = provider(t);
    expect(await p.createCustomer({ name: "Maria", email: "m@x.co", taxId: "12345678909", externalReference: sub.externalReference })).toEqual({ customerRef: "cus_1" });
    expect(await p.createSubscription(sub)).toEqual({ subscriptionRef: "sub_1", checkoutUrl: null });
    expect(t.calls[1]!.url).toBe("https://api-sandbox.asaas.com/v3/subscriptions");
    expect(t.calls[1]!.body).toMatchObject({ customer: "cus_1", value: 49, cycle: "MONTHLY", nextDueDate: "2026-03-10", externalReference: sub.externalReference, billingType: "UNDEFINED" });
    expect(t.calls[1]!.headers.access_token).toBe(KEY);
    expect(t.calls.every((c) => c.url.startsWith("https://api-sandbox.asaas.com/"))).toBe(true);
  });
  it("so BRL, e CPF/CNPJ e obrigatorio", async () => {
    const p = provider(transport(() => ({ json: { id: "x" } })));
    await expect(p.createSubscription({ ...sub, price: { amountMinor: 1900, currency: "USD" } })).rejects.toMatchObject({ code: "asaas.currency_unsupported", kind: "rejected" });
    await expect(p.createCustomer({ name: "M", email: "m@x.co", taxId: null, externalReference: "r" })).rejects.toMatchObject({ code: "asaas.tax_id_required" });
  });
  it("classifica erros: 4xx = recusa; 5xx/rede em POST = incerto (nunca repete); em GET = transitorio", async () => {
    await expect(provider(transport(() => ({ status: 400 }))).createSubscription(sub)).rejects.toMatchObject({ kind: "rejected" });
    await expect(provider(transport(() => ({ status: 503 }))).createSubscription(sub)).rejects.toMatchObject({ kind: "uncertain" });
    const t = transport(() => "boom");
    await expect(provider(t).createSubscription(sub)).rejects.toMatchObject({ kind: "uncertain" });
    expect(t.calls).toHaveLength(1); // sem repeticao automatica
    await expect(provider(transport(() => "boom")).findSubscriptionByReference(sub.externalReference)).rejects.toMatchObject({ kind: "transient" });
    await expect(provider(transport(() => ({ json: {} }))).createSubscription(sub)).rejects.toBeInstanceOf(PaymentProviderError);
  });
  it("procura pela nossa referencia e cancela; recusa referencia fora do padrao", async () => {
    const t = transport((c) => ({ json: c.method === "GET" ? { data: [{ id: "sub_9", externalReference: sub.externalReference }] } : {} }));
    const p = provider(t);
    expect(await p.findSubscriptionByReference(sub.externalReference)).toEqual({ subscriptionRef: "sub_9", checkoutUrl: null });
    expect(t.calls[0]!.url).toBe(`https://api-sandbox.asaas.com/v3/subscriptions?externalReference=${sub.externalReference}&limit=1`);
    expect(await provider(transport(() => ({ json: { data: [] } }))).findSubscriptionByReference(sub.externalReference)).toBeNull();
    expect(await p.findSubscriptionByReference("../etc?x=1")).toBeNull();
    await p.cancelSubscription("sub_9");
    expect(t.calls.at(-1)).toMatchObject({ method: "DELETE", url: "https://api-sandbox.asaas.com/v3/subscriptions/sub_9" });
    await expect(p.cancelSubscription("../customers")).rejects.toMatchObject({ code: "asaas.endpoint_denied" });
  });
  it("sem chave configurada nao chama a rede", async () => {
    const t = transport(() => ({ json: { id: "x" } }));
    const p = new AsaasPaymentProvider({ transport: t.fn, env: {} });
    await expect(p.createSubscription(sub)).rejects.toBeTruthy();
    expect(t.calls).toHaveLength(0);
  });
});

const h = (token = TOKEN) => new Headers({ "asaas-access-token": token });
const body = (o: unknown) => JSON.stringify(o);
describe("aviso (webhook) do Asaas", () => {
  const p = provider(transport(() => ({})));
  it("exige o token configurado, em tempo constante, e a configuracao existir", () => {
    expect(() => p.verifyWebhook(h("errado-errado-errado"), body({ event: "PAYMENT_CONFIRMED" }))).toThrow(WebhookRejectedError);
    expect(() => p.verifyWebhook(new Headers(), body({}))).toThrow(WebhookRejectedError);
    expect(() => new AsaasPaymentProvider({ env: {} }).verifyWebhook(h(), "{}")).toThrow(WebhookRejectedError);
    expect(() => p.verifyWebhook(h(), "nao e json")).toThrow(WebhookRejectedError);
  });
  it("CONFIRMED e RECEIVED do mesmo pagamento geram o MESMO evento (nao estende o periodo duas vezes)", () => {
    const pay = { id: "pay_1", subscription: "sub_1", value: 49 };
    const a = p.verifyWebhook(h(), body({ event: "PAYMENT_CONFIRMED", payment: pay }))!;
    const b = p.verifyWebhook(h(), body({ event: "PAYMENT_RECEIVED", payment: pay }))!;
    expect(a.eventId).toBe(b.eventId);
    expect(a).toMatchObject({ type: "payment_confirmed", subscriptionRef: "sub_1", amount: { amountMinor: 4900, currency: "BRL" }, occurredAt: NOW });
  });
  it("atraso, estorno e fim da assinatura; cobranca avulsa e eventos desconhecidos sao ignorados", () => {
    expect(p.verifyWebhook(h(), body({ event: "PAYMENT_OVERDUE", payment: { id: "pay_2", subscription: "sub_1", value: 49 } }))).toMatchObject({ type: "payment_overdue", amount: null });
    expect(p.verifyWebhook(h(), body({ event: "PAYMENT_REFUNDED", payment: { id: "pay_2", subscription: "sub_1" } }))).toMatchObject({ type: "payment_refunded" });
    expect(p.verifyWebhook(h(), body({ event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_1" } }))).toMatchObject({ type: "subscription_cancelled", subscriptionRef: "sub_1" });
    expect(p.verifyWebhook(h(), body({ event: "PAYMENT_CONFIRMED", payment: { id: "pay_3", value: 10 } }))).toBeNull(); // sem assinatura
    expect(p.verifyWebhook(h(), body({ event: "PAYMENT_CREATED", payment: { id: "pay_4", subscription: "sub_1" } }))).toBeNull();
  });
});

describe("registro de provedores", () => {
  it("so cria o que o ambiente configura; o simulado nunca existe em producao", () => {
    expect(defaultProviderRegistry({}).has("asaas")).toBe(false);
    expect(defaultProviderRegistry(env).get("asaas")?.id).toBe("asaas");
    expect(defaultProviderRegistry({ FMCC_PAYMENT_SIMULATED: "1" }).get("simulated")?.id).toBe("simulated");
    expect(defaultProviderRegistry({ FMCC_PAYMENT_SIMULATED: "1", NODE_ENV: "production" }).has("simulated")).toBe(false);
    expect(defaultProviderRegistry(env).has("toString")).toBe(false);
  });
});
