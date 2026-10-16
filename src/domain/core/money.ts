import { fail, isRecord, ok, type Validation } from "./result";

/**
 * Dinheiro: inteiro na menor unidade da moeda (centavos) e sempre com moeda ISO 4217.
 * Nunca número com vírgula, nunca valor sem moeda (ADR-012, ADR-020).
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

const CURRENCIES: ReadonlySet<string> = new Set(Intl.supportedValuesOf("currency"));

export function isCurrencyCode(v: unknown): v is string {
  return typeof v === "string" && /^[A-Z]{3}$/.test(v) && CURRENCIES.has(v);
}

export function createMoney(amountMinor: unknown, currency: unknown): Validation<Money> {
  if (!Number.isSafeInteger(amountMinor)) return fail("money.amount_must_be_integer_minor_units");
  if (!isCurrencyCode(currency)) return fail("money.currency_must_be_iso_4217");
  return ok({ amountMinor: amountMinor as number, currency });
}

export function parseMoney(v: unknown): Validation<Money> {
  if (!isRecord(v)) return fail("money.must_be_object");
  return createMoney(v.amountMinor, v.currency);
}

/** Soma só na mesma moeda. Sem conversão automática (ADR-012). */
export function addMoney(a: Money, b: Money): Validation<Money> {
  if (a.currency !== b.currency) return fail("money.currency_mismatch_no_automatic_fx");
  return createMoney(a.amountMinor + b.amountMinor, a.currency);
}

/** Totais por moeda, mantidos separados. */
export function sumByCurrency(items: readonly Money[]): Readonly<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const m of items) totals[m.currency] = (totals[m.currency] ?? 0) + m.amountMinor;
  return totals;
}

/** Exibição pela API Intl, no idioma da pessoa; valor segue na moeda de origem. */
export function formatMoney(m: Money, locale: string): string {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: m.currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency }).format(
    m.amountMinor / 10 ** digits
  );
}
