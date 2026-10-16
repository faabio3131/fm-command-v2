/**
 * Decimais exatos como texto, sem ponto flutuante. Usado pelo motor de métricas e pela consolidação entre unidades.
 */
export interface DecimalValue {
  readonly units: bigint;
  readonly scale: number;
}

export function parseDecimal(value: unknown): DecimalValue | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const raw = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const units = BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n);
  return { units, scale: fraction.length };
}

function format(total: bigint, scale: number): string {
  if (scale === 0) return total.toString();
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  const normalized = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${normalized}` : normalized;
}

export function sumDecimals(values: readonly DecimalValue[]): string {
  const scale = Math.max(0, ...values.map((value) => value.scale));
  const total = values.reduce((sum, value) => sum + value.units * 10n ** BigInt(scale - value.scale), 0n);
  return format(total, scale);
}

/** Negativo, zero ou positivo, como em `Array.sort`. */
export function compareDecimals(a: DecimalValue, b: DecimalValue): number {
  const scale = Math.max(a.scale, b.scale);
  const left = a.units * 10n ** BigInt(scale - a.scale);
  const right = b.units * 10n ** BigInt(scale - b.scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** `part` / `total` em porcentagem com uma casa, arredondada para o mais próximo (meio para cima). Total deve ser > 0. */
export function percentOfTotal(part: DecimalValue, total: DecimalValue): string | null {
  const scale = Math.max(part.scale, total.scale);
  const p = part.units * 10n ** BigInt(scale - part.scale);
  const t = total.units * 10n ** BigInt(scale - total.scale);
  if (t <= 0n) return null;
  const tenths = (p * 1000n * 2n + t) / (t * 2n);
  return format(tenths, 1);
}

/**
 * Largura de uma barra em % (0 a 100, uma casa) relativa ao maior valor. Negativo ou nulo não desenha barra.
 * O número só serve para desenhar; o valor mostrado vem do texto exato.
 */
export function barWidthPercent(value: DecimalValue, max: DecimalValue): string {
  if (value.units <= 0n || max.units <= 0n) return "0";
  return percentOfTotal(value, max) ?? "0";
}
