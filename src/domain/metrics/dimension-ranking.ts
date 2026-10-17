import { compareDecimals, parseDecimal, percentOfTotal, sumDecimals, type DecimalValue } from "@/domain/core/decimal";
import { computeMetric, MultiCurrencyAggregationError, type MetricFact } from "./metric-engine";
import type { MetricDefinition } from "./registry";

/**
 * Ranking por uma dimensão dos fatos (hoje: produto, pela linha do pedido). Regra pura, sobre o mesmo motor de métricas.
 * Garantias:
 *  - "Indisponível" nunca vira zero: grupo cujo valor não pode ser calculado aparece sem posição e fora da soma.
 *  - Fato sem a dimensão (linha sem código de produto) não entra em nenhum grupo e não é inventado: vira contagem à parte.
 *  - Moedas diferentes entre grupos suspendem o ranking e o total (ADR-012); dentro de um grupo, moedas misturadas o tornam indisponível.
 */
export interface DimensionRankRow {
  readonly key: string;
  /** Nome para mostrar, se a origem trouxe (descrição do item); senão, o próprio código. */
  readonly label: string;
  readonly value: string | null;
  readonly currency?: string;
  /** 1 = maior. Empates dividem a posição. Nulo quando indisponível ou quando a moeda impede comparar. */
  readonly rank: number | null;
  readonly sharePercent: string | null;
  readonly facts: number;
}

export interface DimensionRanking {
  readonly dimension: string;
  readonly rows: readonly DimensionRankRow[];
  /** Soma dos grupos com valor; nulo quando não há comparável (sem dado ou moedas misturadas). */
  readonly total: { readonly value: string; readonly currency?: string } | null;
  readonly rankingSuspended: boolean;
  /** Fatos que bateram com a métrica mas não têm a dimensão: ficam de fora e são avisados. */
  readonly withoutDimension: number;
}

const keyOf = (fact: MetricFact, dimension: string): string | null => {
  const raw = fact.payload[dimension];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
};

export function rankByDimension(definition: MetricDefinition, facts: readonly MetricFact[], dimension: string): DimensionRanking {
  if (!definition.dimensions.includes(dimension)) throw new Error(`metrics.dimension_not_supported:${definition.metricId}:${dimension}`);
  if (definition.kind !== "sum" && definition.kind !== "count") throw new Error(`metrics.ranking_kind_invalid:${definition.metricId}`);

  // Mesmo filtro do motor (tipo e status), para contar à parte só o que a métrica aceitaria.
  const matching = facts.filter((fact) => fact.factType === definition.factType
    && (!definition.statuses || (typeof fact.payload.status === "string" && definition.statuses.includes(fact.payload.status))));
  const groups = new Map<string, MetricFact[]>();
  let withoutDimension = 0;
  for (const fact of matching) {
    const key = keyOf(fact, dimension);
    if (key === null) { withoutDimension += 1; continue; }
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }

  const computed = [...groups.entries()].map(([key, list]) => {
    let value: string | null = null;
    let currency: string | undefined;
    try {
      const result = computeMetric(definition, list);
      if (result.status === "available") { value = result.value; currency = result.currency; }
    } catch (error) {
      if (!(error instanceof MultiCurrencyAggregationError)) throw error;
    }
    const latest = [...list].sort((a, b) => b.sourceTimestamp.getTime() - a.sourceTimestamp.getTime())
      .map((f) => (typeof f.payload.description === "string" && f.payload.description.trim() !== "" ? f.payload.description.trim() : null)).find((d) => d !== null);
    return { key, label: latest ?? key, value, currency, parsed: value === null ? null : parseDecimal(value), facts: new Set(list.map((f) => f.externalId)).size };
  });

  const reporting = computed.filter((row): row is typeof row & { parsed: DecimalValue } => row.parsed !== null);
  const currencies = new Set(reporting.map((row) => row.currency ?? ""));
  const mixed = currencies.size > 1;
  const total = reporting.length === 0 || mixed ? null
    : { value: sumDecimals(reporting.map((row) => row.parsed)), ...([...currencies][0] ? { currency: [...currencies][0] } : {}) };
  const totalValue = total ? parseDecimal(total.value) : null;

  const sorted = [...reporting].sort((a, b) => compareDecimals(b.parsed, a.parsed) || a.key.localeCompare(b.key));
  const rankOf = new Map<string, number>();
  if (!mixed) {
    sorted.forEach((row, index) => {
      const previous = sorted[index - 1];
      rankOf.set(row.key, previous && compareDecimals(previous.parsed, row.parsed) === 0 ? (rankOf.get(previous.key) as number) : index + 1);
    });
  }
  const unavailable = computed.filter((row) => row.parsed === null).sort((a, b) => a.key.localeCompare(b.key));
  return {
    dimension, total, rankingSuspended: mixed, withoutDimension,
    rows: [...sorted, ...unavailable].map((row) => ({
      key: row.key, label: row.label, value: row.value, ...(row.currency ? { currency: row.currency } : {}),
      rank: rankOf.get(row.key) ?? null,
      sharePercent: row.parsed !== null && totalValue && !mixed ? percentOfTotal(row.parsed, totalValue) : null,
      facts: row.facts,
    })),
  };
}
