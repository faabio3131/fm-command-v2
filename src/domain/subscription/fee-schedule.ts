import { createMoney } from "@/domain/core/money";
import { fail, isRecord, ok, type Validation } from "@/domain/core/result";

export const PAYMENT_METHODS = ["boleto", "pix", "card", "transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Taxa de um meio de cobranca para uma forma de pagamento. Tudo vem de configuracao; nenhum valor padrao existe no codigo. */
export interface FeeSchedule {
  readonly providerId: string;
  readonly method: PaymentMethod;
  readonly currency: string;
  readonly fixedMinor: number;
  /** Centesimos de ponto percentual: 199 = 1,99%. */
  readonly percentBps: number;
  readonly minMinor: number;
  readonly maxMinor: number | null;
  readonly effectiveFrom: Date;
}

const isNat = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

export function parseFeeSchedule(v: unknown): Validation<FeeSchedule> {
  if (!isRecord(v)) return fail("fee.must_be_object");
  if (typeof v.providerId !== "string" || !/^[a-z][a-z0-9_]{1,31}$/.test(v.providerId)) return fail("fee.provider_invalid");
  if (!PAYMENT_METHODS.includes(v.method as PaymentMethod)) return fail("fee.method_invalid");
  const cur = createMoney(0, v.currency);
  if (!cur.ok) return cur;
  if (!isNat(v.fixedMinor) || !isNat(v.minMinor)) return fail("fee.amount_invalid");
  if (!isNat(v.percentBps) || v.percentBps > 10_000) return fail("fee.percent_invalid");
  if (v.maxMinor !== null && !(isNat(v.maxMinor) && v.maxMinor >= v.minMinor)) return fail("fee.max_invalid");
  if (!(v.effectiveFrom instanceof Date) || Number.isNaN(v.effectiveFrom.getTime())) return fail("fee.effective_from_invalid");
  return ok({
    providerId: v.providerId, method: v.method as PaymentMethod, currency: cur.value.currency, fixedMinor: v.fixedMinor,
    percentBps: v.percentBps, minMinor: v.minMinor, maxMinor: v.maxMinor as number | null, effectiveFrom: v.effectiveFrom,
  });
}

export interface FeeEstimate { readonly feeMinor: number; readonly netMinor: number; readonly currency: string }

/**
 * Taxa estimada = fixo + percentual (arredondado para o centavo mais proximo, meio para cima), limitada entre minimo e maximo.
 * Estimativa: o banco e quem cobra de fato; a diferenca aparece na conciliacao. A taxa nunca passa do valor cobrado.
 */
export function estimateFee(schedule: FeeSchedule, amountMinor: number, currency: string): FeeEstimate | null {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || currency !== schedule.currency) return null;
  let fee = schedule.fixedMinor + Math.floor((amountMinor * schedule.percentBps + 5_000) / 10_000);
  fee = Math.max(fee, schedule.minMinor);
  if (schedule.maxMinor !== null) fee = Math.min(fee, schedule.maxMinor);
  fee = Math.min(fee, amountMinor);
  return { feeMinor: fee, netMinor: amountMinor - fee, currency };
}
