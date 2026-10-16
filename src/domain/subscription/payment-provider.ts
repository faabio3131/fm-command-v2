import type { Money } from "@/domain/core/money";
import type { PaymentMethod } from "./fee-schedule";
import type { BillingInterval } from "./plan";

/**
 * Contrato unico de meio de cobranca (ADR-021). O restante do sistema so conhece esta interface; Asaas, simulador ou qualquer outro
 * sao implementacoes escolhidas por configuracao (rota por pais/moeda no banco), sem mudar codigo de negocio.
 */
export class PaymentProviderError extends Error {
  constructor(readonly code: string, readonly kind: "transient" | "rejected" | "uncertain") { super(code); this.name = "PaymentProviderError"; }
}
export class WebhookRejectedError extends Error {
  constructor(readonly code: string) { super(code); this.name = "WebhookRejectedError"; }
}

export interface CustomerInput { readonly name: string; readonly email: string; readonly taxId: string | null; readonly externalReference: string }
export interface CreateSubscriptionInput {
  readonly customerRef: string;
  readonly price: Money;
  readonly interval: BillingInterval;
  /** Nossa identidade da assinatura: o provedor a devolve, e e assim que se recupera uma criacao incerta. */
  readonly externalReference: string;
  readonly description: string;
  /** Primeira cobranca (AAAA-MM-DD, UTC). */
  readonly firstDueDate: string;
}
export interface ProviderSubscription { readonly subscriptionRef: string; readonly checkoutUrl: string | null }

export type PaymentEventType = "payment_confirmed" | "payment_overdue" | "payment_refunded" | "subscription_cancelled";
/** Evento normalizado: o que o provedor disse, sem o formato dele. A empresa nunca vem do evento; vem da assinatura que NOS gravamos. */
export interface PaymentEvent {
  readonly eventId: string;
  readonly type: PaymentEventType;
  readonly subscriptionRef: string;
  readonly paymentRef: string | null;
  readonly amount: Money | null;
  readonly occurredAt: Date;
}

/**
 * Como o provedor cobra de novo a cada ciclo.
 * - provider_recurring: o provedor cria a assinatura e cobra sozinho (cartao, debito automatico, Asaas).
 * - invoice_each_cycle: o cliente paga cada ciclo por conta propria (boleto, PIX, metodos locais); o sistema gera e acompanha cada cobranca.
 *   AINDA NAO IMPLEMENTADO: um provedor assim e declarado, mas nenhuma rota o usa ate o fluxo existir.
 */
export type BillingMode = "provider_recurring" | "invoice_each_cycle";
export interface ProviderCapabilities {
  readonly billingMode: BillingMode;
  /** Formas de pagamento que o provedor aceita (cada uma tem sua taxa na tabela de taxas). */
  readonly methods: readonly PaymentMethod[];
  readonly refunds: boolean;
}

export interface PaymentProvider {
  readonly id: string;
  /** Moedas que o provedor sabe cobrar; a rota so aceita pares moeda/provedor compativeis. */
  readonly currencies: readonly string[];
  readonly capabilities: ProviderCapabilities;
  createCustomer(input: CustomerInput): Promise<{ customerRef: string }>;
  createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription>;
  /** Procura pela nossa referencia; usado para recuperar uma criacao cuja resposta se perdeu (nunca repete o POST as cegas). */
  findSubscriptionByReference(externalReference: string): Promise<ProviderSubscription | null>;
  cancelSubscription(subscriptionRef: string): Promise<void>;
  /** Valida a autenticidade e devolve o evento normalizado; lanca WebhookRejectedError se nao for autentico ou nao for um evento que importa. */
  verifyWebhook(headers: Headers, rawBody: string): PaymentEvent | null;
}

export type ProviderFactory = () => PaymentProvider;
