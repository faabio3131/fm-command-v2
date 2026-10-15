import { createMoney, type Money } from "@/domain/core/money";
import { fail, isRecord, ok, type Validation } from "@/domain/core/result";

export const INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof INTERVALS)[number];

/** Um plano pode ter varios precos, um por moeda (e, se preciso, por pais). Nunca ha conversao automatica entre moedas (ADR-012, ADR-020). */
export interface PlanPrice {
  readonly planId: string;
  readonly currency: string;
  /** null = vale para qualquer pais naquela moeda; um pais especifico tem preferencia. */
  readonly country: string | null;
  readonly amountMinor: number;
  readonly interval: BillingInterval;
}

export function parsePlanPrice(v: unknown): Validation<PlanPrice> {
  if (!isRecord(v)) return fail("plan.price_must_be_object");
  if (typeof v.planId !== "string" || !v.planId) return fail("plan.price_plan_required");
  const money = createMoney(v.amountMinor, v.currency);
  if (!money.ok) return money;
  if (money.value.amountMinor <= 0) return fail("plan.price_must_be_positive");
  if (v.country !== null && !(typeof v.country === "string" && /^[A-Z]{2}$/.test(v.country))) return fail("plan.price_country_invalid");
  if (!INTERVALS.includes(v.interval as BillingInterval)) return fail("plan.price_interval_invalid");
  return ok({ planId: v.planId, currency: money.value.currency, country: v.country as string | null, amountMinor: money.value.amountMinor, interval: v.interval as BillingInterval });
}

/**
 * Preco aplicavel a uma empresa: a moeda do perfil da empresa e obrigatoria (sem preco naquela moeda = sem oferta, nunca converte);
 * entre os precos da moeda, o do pais da empresa vence o generico.
 */
export function selectPrice(prices: readonly PlanPrice[], profile: { currency: string; country: string }): PlanPrice | null {
  const inCurrency = prices.filter((p) => p.currency === profile.currency);
  return inCurrency.find((p) => p.country === profile.country) ?? inCurrency.find((p) => p.country === null) ?? null;
}

export const priceMoney = (p: Pick<PlanPrice, "amountMinor" | "currency">): Money => ({ amountMinor: p.amountMinor, currency: p.currency });
