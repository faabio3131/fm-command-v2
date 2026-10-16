export type FinancialMetricState = "available" | "unavailable" | "pending_semantics";
export type FinancialDerivedState = "available" | "unavailable" | "incompatible" | "pending_semantics";

export interface FinancialMetricTarget {
  readonly metricId: string;
  readonly displayName: string;
  readonly definitionStatus: "implemented" | "pending_semantics";
}

export const FINANCIAL_METRIC_TARGETS: readonly FinancialMetricTarget[] = [
  { metricId: "billing.gross_billed", displayName: "Faturamento bruto emitido", definitionStatus: "implemented" },
  { metricId: "revenue.cash_collected", displayName: "Caixa recebido", definitionStatus: "implemented" },
  { metricId: "receivable.delinquent_amount", displayName: "Inadimplência", definitionStatus: "implemented" },
  { metricId: "cost.infrastructure.total", displayName: "Custos de infraestrutura", definitionStatus: "implemented" },
  { metricId: "cost.operating.total", displayName: "Custos operacionais rastreáveis", definitionStatus: "implemented" },
  { metricId: "revenue.mrr", displayName: "MRR", definitionStatus: "pending_semantics" },
  { metricId: "revenue.arr", displayName: "ARR", definitionStatus: "pending_semantics" },
] as const;

export const UNIT_ECONOMICS_TARGETS = [
  { metricId: "acquisition.cac", displayName: "CAC", definitionStatus: "pending_semantics" as const },
  { metricId: "customer.ltv", displayName: "LTV", definitionStatus: "pending_semantics" as const },
  { metricId: "customer.payback", displayName: "Payback", definitionStatus: "pending_semantics" as const },
  { metricId: "revenue.arpu", displayName: "ARPU", definitionStatus: "pending_semantics" as const },
  { metricId: "finance.operating_margin.rate", displayName: "Margem operacional", definitionStatus: "pending_semantics" as const },
] as const;

export const FINANCIAL_DERIVED_METRICS = [
  {
    metricId: "finance.operating_result",
    displayName: "Resultado operacional",
    description: "Caixa recebido menos custos de infraestrutura e custos operacionais, calculado deterministicamente somente com moeda e período compatíveis.",
  },
] as const;
