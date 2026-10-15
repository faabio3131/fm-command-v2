export type GrowthMetricState = "available" | "unavailable" | "pending_semantics";

export interface GrowthMetricTarget {
  readonly metricId: string;
  readonly displayName: string;
  readonly definitionStatus: "implemented" | "pending_semantics";
}

export const GROWTH_METRIC_TARGETS: readonly GrowthMetricTarget[] = [
  { metricId: "lead.created.count", displayName: "Leads criados", definitionStatus: "implemented" },
  { metricId: "trial.starts.count", displayName: "Testes gratuitos iniciados", definitionStatus: "implemented" },
  { metricId: "trial.conversion.rate", displayName: "Conversão de trial para assinatura", definitionStatus: "pending_semantics" },
  { metricId: "acquisition.cac", displayName: "CAC", definitionStatus: "pending_semantics" },
  { metricId: "channel.attributed.leads.count", displayName: "Leads atribuídos por canal", definitionStatus: "pending_semantics" },
] as const;
