import type { PaymentProvider, ProviderFactory } from "@/domain/subscription/payment-provider";
import { AsaasPaymentProvider } from "./asaas-payment-provider";
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
  if (env.FMCC_ASAAS_SANDBOX_API_KEY) factories.asaas = () => new AsaasPaymentProvider({ env });
  if (env.FMCC_PAYMENT_SIMULATED === "1" && env.NODE_ENV !== "production") {
    const secret = env.FMCC_PAYMENT_SIMULATED_SECRET ?? "simulado-sem-valor-real";
    factories.simulated = () => new SimulatedPaymentProvider("simulated", secret);
  }
  return new PaymentProviderRegistry(factories);
}
