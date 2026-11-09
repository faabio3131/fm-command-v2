import type { PaymentProvider, ProviderFactory } from "@/domain/subscription/payment-provider";
import { AsaasPaymentProvider } from "./asaas-payment-provider";
import { CaktoPaymentProvider } from "./cakto-payment-provider";
import { SimulatedPaymentProvider } from "./simulated-payment-provider";

/** Instancia sob demanda os provedores que o ambiente permite. Nenhum e criado sem a configuracao propria dele. */
export class PaymentProviderRegistry {
  private readonly cache = new Map<string, PaymentProvider>();
  constructor(private readonly factories: Readonly<Record<string, ProviderFactory>>) {}
  has(id: string): boolean { return Object.hasOwn(this.factories, id); }
  get(id: string): PaymentProvider | null {
    if (!this.has(id)) return null;
    let p = this.cache.get(id);
    if (!p) { p = this.factories[id]!(); this.cache.set(id, p); }
    return p;
  }
}

export function defaultProviderRegistry(env: Record<string, string | undefined> = process.env): PaymentProviderRegistry {
  const factories: Record<string, ProviderFactory> = {};
  // Asaas so em sandbox. Em producao so liga com autorizacao explicita (a chave de sandbox pode ja existir por causa da cobranca Iron),
  // e nunca sem o token do webhook (senao todos os avisos seriam recusados).
  const production = env.NODE_ENV === "production";
  const asaasWebhookReady = (env.FMCC_ASAAS_SAAS_WEBHOOK_TOKEN ?? "").length >= 16;
  if (env.FMCC_ASAAS_SANDBOX_API_KEY && asaasWebhookReady && (!production || env.FMCC_SAAS_ALLOW_SANDBOX === "1")) {
    factories.asaas = () => new AsaasPaymentProvider({ env });
  }
  // Hosted Cakto is enabled only with a configured signed webhook and exact checkout offers.
  // Routes remain governed by fmcc_saas_payment_route (do not auto-activate all tenants).
  if ((env.FMCC_CAKTO_WEBHOOK_SECRET ?? "").length >= 24 && env.FMCC_CAKTO_CHECKOUTS_JSON) {
    factories.cakto = () => new CaktoPaymentProvider(env);
  }
  // Simulador: ligado so de forma explicita, fora de producao e com segredo proprio (sem valor padrao conhecido).
  const simSecret = env.FMCC_PAYMENT_SIMULATED_SECRET ?? "";
  if (env.FMCC_PAYMENT_SIMULATED === "1" && !production && simSecret.length >= 16) {
    factories.simulated = () => new SimulatedPaymentProvider("simulated", simSecret);
  }
  return new PaymentProviderRegistry(factories);
}
