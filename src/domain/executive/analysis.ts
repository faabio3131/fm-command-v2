import type { MetricView } from "@/application/metrics/metric-service";

export type ExecutiveSignalStatus = "available" | "unavailable" | "incompatible" | "insufficient_evidence";
export type EpistemicKind = "fact" | "inference" | "recommendation" | "forecast" | "unavailable";
export type VariationDirection = "increased" | "decreased" | "unchanged";

export interface ExecutiveVariation {
  readonly status: ExecutiveSignalStatus;
  readonly direction?: VariationDirection;
  readonly delta?: string;
  readonly reason?: string;
  readonly current?: MetricView;
  readonly previous?: MetricView;
  readonly provenanceRefs: readonly string[];
}

function decimalParts(raw: string): { units: bigint; scale: number } | null {
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

function normalizeDecimal(units: bigint, scale: number): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  if (scale === 0) return `${negative ? "-" : ""}${absolute}`;
  const padded = absolute.toString().padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const rawFraction = padded.slice(-scale);
  const fraction = rawFraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function subtractDecimalStrings(left: string, right: string): string | null {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const av = a.units * 10n ** BigInt(scale - a.scale);
  const bv = b.units * 10n ** BigInt(scale - b.scale);
  return normalizeDecimal(av - bv, scale);
}

function temporalKey(value: MetricView): string | null {
  if (value.asOf) return `asof:${value.asOf.toISOString()}`;
  if (value.periodStart || value.periodEnd) {
    return `period:${value.periodStart?.toISOString() ?? "?"}:${value.periodEnd?.toISOString() ?? "?"}`;
  }
  return null;
}

export function computeExecutiveVariation(history: readonly MetricView[]): ExecutiveVariation {
  if (history.length < 2) return { status: "insufficient_evidence", reason: "history", provenanceRefs: [] };
  const [current, previous] = history;
  if (current.value === null || previous.value === null) {
    return { status: "unavailable", reason: "missing_value", provenanceRefs: [] };
  }
  if (current.unit !== previous.unit) {
    return { status: "incompatible", reason: "unit", provenanceRefs: [] };
  }
  if ((current.currency ?? null) !== (previous.currency ?? null)) {
    return { status: "incompatible", reason: "currency", provenanceRefs: [] };
  }
  const currentTime = temporalKey(current);
  const previousTime = temporalKey(previous);
  if (!currentTime || !previousTime || currentTime === previousTime) {
    return { status: "insufficient_evidence", reason: "period", provenanceRefs: [] };
  }
  const delta = subtractDecimalStrings(current.value, previous.value);
  if (delta === null) return { status: "incompatible", reason: "numeric_value", provenanceRefs: [] };
  const numeric = decimalParts(delta);
  if (!numeric) return { status: "incompatible", reason: "numeric_value", provenanceRefs: [] };
  const direction: VariationDirection = numeric.units > 0n ? "increased" : numeric.units < 0n ? "decreased" : "unchanged";
  return {
    status: "available",
    direction,
    delta,
    current,
    previous,
    provenanceRefs: [...new Set([...current.provenanceRefs, ...previous.provenanceRefs])],
  };
}
