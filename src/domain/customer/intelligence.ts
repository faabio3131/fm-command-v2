export type CustomerMetricState = "available" | "unavailable" | "pending_semantics";

export interface CustomerMetricTarget {
  readonly metricId: string;
  readonly displayName: string;
  readonly definitionStatus: "implemented" | "pending_semantics";
}

export const CUSTOMER_INTELLIGENCE_TARGETS: readonly CustomerMetricTarget[] = [
  { metricId: "usage.active_users.dau", displayName: "Usuários ativos diários (DAU)", definitionStatus: "implemented" },
  { metricId: "usage.engagement.events", displayName: "Eventos de engajamento", definitionStatus: "implemented" },
  { metricId: "support.ticket.open.count", displayName: "Chamados de suporte abertos", definitionStatus: "implemented" },
  { metricId: "usage.active_users.mau", displayName: "Usuários ativos mensais (MAU)", definitionStatus: "pending_semantics" },
  { metricId: "usage.feature_adoption.rate", displayName: "Adoção de funcionalidade", definitionStatus: "pending_semantics" },
  { metricId: "customer.risk.score", displayName: "Risco do cliente", definitionStatus: "pending_semantics" },
  { metricId: "customer.experience.score", displayName: "Indicador de experiência", definitionStatus: "pending_semantics" },
] as const;
