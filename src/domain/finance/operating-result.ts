export interface FinancialMetricInput {
  readonly metricId: string;
  readonly value: string | null;
  readonly unit: string;
  readonly currency?: string;
  readonly periodStart?: Date;
  readonly periodEnd?: Date;
  readonly asOf?: Date;
  readonly sourceTimestamp?: Date;
  readonly provenanceRefs: readonly string[];
}

export type OperatingResult =
  | {
      readonly status: "available";
      readonly value: string;
      readonly currency: string;
      readonly periodStart?: Date;
      readonly periodEnd?: Date;
      readonly asOf?: Date;
      readonly sourceTimestamp?: Date;
      readonly provenanceRefs: readonly string[];
      readonly direction: "profit" | "loss" | "break_even";
    }
  | { readonly status: "unavailable"; readonly reason: "missing_input" | "invalid_decimal" }
  | { readonly status: "incompatible"; readonly reason: "currency" | "period" };

interface DecimalValue {
  readonly units: bigint;
  readonly scale: number;
}

function parseDecimal(raw: string): DecimalValue | null {
  const value = raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  return {
    units: BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n),
    scale: fraction.length,
  };
}

function normalized(units: bigint, scale: number): string {
  if (scale === 0) return units.toString();
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  const value = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${value}` : value;
}

function temporalKey(value: FinancialMetricInput): string | null {
  if (value.asOf) return `asof:${value.asOf.toISOString()}`;
  if (value.periodStart || value.periodEnd) {
    return `period:${value.periodStart?.toISOString() ?? "?"}:${value.periodEnd?.toISOString() ?? "?"}`;
  }
  return null;
}

export function computeOperatingResult(
  cashCollected: FinancialMetricInput | null,
  infrastructureCost: FinancialMetricInput | null,
  operatingCost: FinancialMetricInput | null,
): OperatingResult {
  const inputs = [cashCollected, infrastructureCost, operatingCost];
  if (inputs.some((item) => item === null || item.value === null)) {
    return { status: "unavailable", reason: "missing_input" };
  }

  const values = inputs as FinancialMetricInput[];
  const currencies = new Set(values.map((item) => item.currency).filter((item): item is string => Boolean(item)));
  if (currencies.size !== 1 || values.some((item) => !item.currency)) {
    return { status: "incompatible", reason: "currency" };
  }

  const temporalKeys = values.map(temporalKey);
  if (temporalKeys.some((key) => key === null) || !temporalKeys.every((key) => key === temporalKeys[0])) {
    return { status: "incompatible", reason: "period" };
  }

  const decimals = values.map((item) => parseDecimal(item.value as string));
  if (decimals.some((item) => item === null)) {
    return { status: "unavailable", reason: "invalid_decimal" };
  }

  const parsed = decimals as DecimalValue[];
  const scale = Math.max(...parsed.map((item) => item.scale));
  const aligned = parsed.map((item) => item.units * 10n ** BigInt(scale - item.scale));
  const result = aligned[0] - aligned[1] - aligned[2];

  const sourceTimestamps = values.map((item) => item.sourceTimestamp?.getTime()).filter((item): item is number => item !== undefined);
  const reference = values[0];

  return {
    status: "available",
    value: normalized(result, scale),
    currency: [...currencies][0],
    periodStart: reference.periodStart,
    periodEnd: reference.periodEnd,
    asOf: reference.asOf,
    sourceTimestamp: sourceTimestamps.length ? new Date(Math.max(...sourceTimestamps)) : undefined,
    provenanceRefs: [...new Set(values.flatMap((item) => item.provenanceRefs))],
    direction: result > 0n ? "profit" : result < 0n ? "loss" : "break_even",
  };
}
