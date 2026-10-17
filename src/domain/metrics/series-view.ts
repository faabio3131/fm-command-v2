import { parseDecimal } from "@/domain/core/decimal";
import type { ConsolidatedTotal } from "@/domain/metrics/unit-comparison";

/**
 * Leitura da série mensal para o painel (etapa 9H). Regras puras: o gráfico só desenha o que o motor devolveu.
 * Mês indisponível vira lacuna (nunca zero) e a variação só existe entre dois meses FECHADOS, ambos com valor, na mesma moeda.
 */
export interface SeriesPoint {
  readonly key: string;
  readonly closed: boolean;
  readonly total: ConsolidatedTotal;
}

export interface TrendPoint {
  readonly key: string;
  readonly closed: boolean;
  /** Texto decimal do motor; nulo = indisponível. */
  readonly value: string | null;
  readonly currency?: string;
  /** Mês com cobertura parcial (nem todas as filiais tinham dado). */
  readonly partial: boolean;
}

export function toTrendPoints(points: readonly SeriesPoint[]): readonly TrendPoint[] {
  return points.map((p) => p.total.status === "available"
    ? { key: p.key, closed: p.closed, value: p.total.value, currency: p.total.currency, partial: p.total.partial }
    : { key: p.key, closed: p.closed, value: null, partial: false });
}

/**
 * Variação percentual de `previous` para `current` com uma casa (meio afastando de zero), em inteiros exatos.
 * Base zero ou negativa não tem percentual com sentido: devolve nulo em vez de infinito ou número enganoso.
 */
export function changePercent(previous: string, current: string): string | null {
  const a = parseDecimal(previous);
  const b = parseDecimal(current);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const p = a.units * 10n ** BigInt(scale - a.scale);
  const c = b.units * 10n ** BigInt(scale - b.scale);
  if (p <= 0n) return null;
  const diff = c - p;
  const negative = diff < 0n;
  const abs = negative ? -diff : diff;
  const tenths = (abs * 1000n * 2n + p) / (p * 2n);
  const whole = tenths / 10n;
  const frac = tenths % 10n;
  const text = `${whole}.${frac}`;
  return negative && tenths !== 0n ? `-${text}` : text;
}

export type MonthDelta =
  | { readonly status: "available"; readonly percent: string; readonly direction: "up" | "down" | "flat"; readonly fromKey: string; readonly toKey: string }
  | { readonly status: "unavailable"; readonly reason: "not_enough_months" | "no_data" | "mixed_currency" | "no_base" };

/** Compara os dois últimos meses fechados. O mês em andamento fica de fora de propósito: comparar mês parcial com mês inteiro enganaria. */
export function lastClosedDelta(points: readonly TrendPoint[]): MonthDelta {
  const closed = points.filter((p) => p.closed);
  if (closed.length < 2) return { status: "unavailable", reason: "not_enough_months" };
  const prev = closed[closed.length - 2];
  const cur = closed[closed.length - 1];
  if (prev.value === null || cur.value === null) return { status: "unavailable", reason: "no_data" };
  if ((prev.currency ?? null) !== (cur.currency ?? null)) return { status: "unavailable", reason: "mixed_currency" };
  const percent = changePercent(prev.value, cur.value);
  if (percent === null) return { status: "unavailable", reason: "no_base" };
  const n = Number(percent);
  return { status: "available", percent, direction: n > 0 ? "up" : n < 0 ? "down" : "flat", fromKey: prev.key, toKey: cur.key };
}
