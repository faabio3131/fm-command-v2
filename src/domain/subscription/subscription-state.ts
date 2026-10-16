import type { Money } from "@/domain/core/money";
import type { PaymentEvent } from "./payment-provider";
import type { BillingInterval } from "./plan";

export type SubscriptionState = "creating" | "pending" | "active" | "past_due" | "cancelled" | "failed";
export const LIVE_STATES: readonly SubscriptionState[] = ["creating", "pending", "active", "past_due"];

export interface SubscriptionSnapshot {
  readonly state: SubscriptionState;
  readonly price: Money;
  readonly interval: BillingInterval;
  readonly currentPeriodEnd: Date | null;
  readonly lastEventAt: Date | null;
}

export type TransitionOutcome = "applied" | "ignored_stale" | "ignored_state" | "amount_mismatch" | "amount_missing";
export interface Transition { readonly outcome: TransitionOutcome; readonly next: SubscriptionSnapshot }

/** Soma meses/anos em UTC sem estourar o fim do mes (31/jan + 1 mes = 28 ou 29/fev). */
export function addInterval(from: Date, interval: BillingInterval): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (interval === "month" ? 1 : 12));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * Aplica um evento do provedor a uma assinatura. Pura e deterministica.
 * - Pagamento confirmado ativa e estende o periodo, mas so se valor e moeda forem exatamente os do preco gravado na assinatura.
 * - Eventos antigos de atraso/cancelamento (anteriores ao ultimo evento aplicado) sao ignorados; pagamento confirmado nunca e descartado por idade.
 * - Assinatura cancelada ou que falhou nao volta a vida por evento.
 */
export function applyPaymentEvent(s: SubscriptionSnapshot, e: PaymentEvent): Transition {
  const keep = (outcome: TransitionOutcome): Transition => ({ outcome, next: s });
  if (s.state === "cancelled" || s.state === "failed" || s.state === "creating") return keep("ignored_state");
  const stamp = (n: Partial<SubscriptionSnapshot>): SubscriptionSnapshot => ({ ...s, ...n, lastEventAt: s.lastEventAt && s.lastEventAt > e.occurredAt ? s.lastEventAt : e.occurredAt });

  if (e.type === "payment_confirmed") {
    // Pagamento sem valor informado nunca ativa: so vale com valor e moeda exatamente iguais ao preco gravado.
    if (!e.amount) return keep("amount_missing");
    if (e.amount.amountMinor !== s.price.amountMinor || e.amount.currency !== s.price.currency) return keep("amount_mismatch");
    const base = s.currentPeriodEnd && s.currentPeriodEnd > e.occurredAt ? s.currentPeriodEnd : e.occurredAt;
    return { outcome: "applied", next: stamp({ state: "active", currentPeriodEnd: addInterval(base, s.interval) }) };
  }
  if (s.lastEventAt && e.occurredAt < s.lastEventAt) return keep("ignored_stale");
  if (e.type === "payment_overdue") {
    if (s.state !== "active") return keep("ignored_state");
    return { outcome: "applied", next: stamp({ state: "past_due" }) };
  }
  if (e.type === "payment_refunded") {
    if (s.state === "pending") return keep("ignored_state");
    const end = s.currentPeriodEnd && s.currentPeriodEnd < e.occurredAt ? s.currentPeriodEnd : e.occurredAt;
    return { outcome: "applied", next: stamp({ state: "past_due", currentPeriodEnd: end }) };
  }
  return { outcome: "applied", next: stamp({ state: "cancelled" }) };
}

export const DEFAULT_GRACE_DAYS = 3;

/**
 * Direito de uso. Ativa/em atraso: ate o fim do periodo pago + carencia (o aviso do provedor pode atrasar).
 * Cancelada: ate o fim do periodo ja pago, sem carencia. Pendente, criando ou falha: nao.
 */
export function isEntitled(s: Pick<SubscriptionSnapshot, "state" | "currentPeriodEnd">, now: Date, graceDays = DEFAULT_GRACE_DAYS): boolean {
  if (!s.currentPeriodEnd) return false;
  if (s.state === "active" || s.state === "past_due") return now.getTime() <= s.currentPeriodEnd.getTime() + graceDays * 86_400_000;
  if (s.state === "cancelled") return now.getTime() <= s.currentPeriodEnd.getTime();
  return false;
}
