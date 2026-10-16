import { parseDecimal as decimal, sumDecimals, type DecimalValue } from "@/domain/core/decimal";
import { currencyExponent } from "@/domain/core/currency-exponent";
import type { MetricDefinition } from "./registry";

/** 123456 com 2 casas -> "1234.56"; 5 com 2 casas -> "0.05"; negativo mantém o sinal. */
export function minorToDecimalText(minor: number, exponent: number): string {
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(-exponent)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export interface MetricFact {
  readonly id: string;
  readonly externalId: string;
  readonly factType: string;
  readonly payload: Record<string, unknown>;
  readonly sourceTimestamp: Date;
  readonly provenanceRef: string;
}

export type MetricComputation =
  | { status: "available"; value: string; unit: string; currency?: string; sourceTimestamp: Date; provenanceRefs: string[]; qualityStatus: "unknown" }
  | { status: "missing"; value: null; unit: string; sourceTimestamp: null; provenanceRefs: []; qualityStatus: "missing" };

export class MultiCurrencyAggregationError extends Error {
  constructor() { super("metrics.fx_policy_required"); }
}

export function computeMetric(definition: MetricDefinition, facts: readonly MetricFact[]): MetricComputation {
  const relevant = facts.filter((fact) =>
    fact.factType === definition.factType
    && (!definition.statuses || (typeof fact.payload.status === "string" && definition.statuses.includes(fact.payload.status))));
  if (relevant.length === 0) return { status: "missing", value: null, unit: definition.unit, sourceTimestamp: null, provenanceRefs: [], qualityStatus: "missing" };

  const sourceTimestamp = new Date(Math.max(...relevant.map((fact) => fact.sourceTimestamp.getTime())));
  const provenanceRefs = relevant.map((fact) => fact.provenanceRef);

  if (definition.kind === "count") {
    return {
      status: "available", value: String(new Set(relevant.map((fact) => fact.externalId)).size),
      unit: definition.unit, sourceTimestamp, provenanceRefs, qualityStatus: "unknown",
    };
  }

  const values = relevant.map((fact) => {
    const raw = definition.valueField ? fact.payload[definition.valueField] : null;
    if (definition.valueScale !== "minor") return decimal(raw);
    // Menor unidade (centavos) -> decimal exato, sem ponto flutuante. Só inteiro seguro vale.
    if (typeof raw !== "number" || !Number.isSafeInteger(raw)) return null;
    const currency = definition.currencyField ? fact.payload[definition.currencyField] : undefined;
    return decimal(minorToDecimalText(raw, currencyExponent(typeof currency === "string" ? currency : undefined)));
  });
  if (values.some((value) => value === null)) {
    return { status: "missing", value: null, unit: definition.unit, sourceTimestamp: null, provenanceRefs: [], qualityStatus: "missing" };
  }

  const currencies = new Set(relevant.map((fact) => definition.currencyField ? fact.payload[definition.currencyField] : undefined).filter((value): value is string => typeof value === "string" && value.length > 0));
  if (currencies.size > 1) throw new MultiCurrencyAggregationError();

  return {
    status: "available", value: sumDecimals(values as DecimalValue[]), unit: definition.unit,
    currency: currencies.size === 1 ? [...currencies][0] : undefined,
    sourceTimestamp, provenanceRefs, qualityStatus: "unknown",
  };
}
