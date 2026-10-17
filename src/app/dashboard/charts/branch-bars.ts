import { barWidthPercent, compareDecimals, parseDecimal } from "@/domain/core/decimal";
import type { UnitComparison } from "@/domain/metrics/unit-comparison";
import type { Locale } from "@/i18n/locales";
import type { BarChartItem } from "./bar-chart";

/** Só exibição: o cálculo é feito em decimais exatos no domínio. Intl aceita o texto decimal sem passar por ponto flutuante. */
export function formatBranchValue(value: string, unit: string, currency: string | undefined, locale: Locale): string {
  const amount = value as unknown as number;
  if (unit === "currency" && currency) return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  if (unit === "percent") return `${new Intl.NumberFormat(locale).format(amount)}%`;
  return new Intl.NumberFormat(locale).format(amount);
}

export interface BranchBars {
  readonly items: readonly BarChartItem[];
  /** Filiais com valor que ficaram de fora por causa do limite. */
  readonly hiddenCount: number;
  /** Filiais sem valor: nunca viram barra nem zero. */
  readonly unavailableCount: number;
}

/**
 * Barras por filial a partir da comparação do domínio. Sem `limit`, mostra todas as filiais na ordem recebida (tela Filiais),
 * com as indisponíveis escritas como tal. Com `limit` (painel inicial), mostra só as de maior valor, em ordem de posição,
 * e conta as que ficaram de fora e as indisponíveis. Ranking suspenso (moedas diferentes) nunca desenha barra.
 */
export function buildBranchBars(comparison: UnitComparison, unit: string, locale: Locale, limit?: number): BranchBars {
  const reporting = comparison.branches.filter((b) => b.value !== null);
  const max = reporting.map((b) => parseDecimal(b.value)).filter((v) => v !== null).sort((a, b) => compareDecimals(b, a))[0];
  const toItem = (b: UnitComparison["branches"][number]): BarChartItem => ({
    id: b.unitId,
    label: b.name,
    valueText: b.value === null ? null : formatBranchValue(b.value, unit, b.currency, locale),
    widthPercent: b.value === null || !max || comparison.rankingSuspended ? "0" : barWidthPercent(parseDecimal(b.value)!, max),
  });
  const unavailableCount = comparison.branches.length - reporting.length;
  if (limit === undefined) return { items: comparison.branches.map(toItem), hiddenCount: 0, unavailableCount };
  const ordered = reporting
    .slice()
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
  const shown = ordered.slice(0, Math.max(0, limit));
  return { items: shown.map(toItem), hiddenCount: ordered.length - shown.length, unavailableCount };
}
