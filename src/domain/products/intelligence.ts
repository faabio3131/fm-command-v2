export type ProductMetricCategory = "acquisition" | "activation" | "engagement" | "revenue" | "churn" | "health";

export interface ProductMetricTarget {
  readonly category: ProductMetricCategory;
  readonly metricId: string;
  readonly displayName: string;
  readonly definitionStatus: "implemented" | "pending_semantics";
}

export const PRODUCT_INTELLIGENCE_TARGETS: readonly ProductMetricTarget[] = [
  { category: "acquisition", metricId: "lead.created.count", displayName: "Potenciais clientes criados", definitionStatus: "implemented" },
  { category: "acquisition", metricId: "trial.starts.count", displayName: "Testes gratuitos iniciados", definitionStatus: "implemented" },
  { category: "activation", metricId: "activation.completed.count", displayName: "Ativações concluídas", definitionStatus: "pending_semantics" },
  { category: "activation", metricId: "activation.rate", displayName: "Taxa de ativação", definitionStatus: "pending_semantics" },
  { category: "engagement", metricId: "usage.active_users.dau", displayName: "Usuários ativos diários (DAU)", definitionStatus: "implemented" },
  { category: "engagement", metricId: "usage.active_users.mau", displayName: "Usuários ativos mensais (MAU)", definitionStatus: "pending_semantics" },
  { category: "engagement", metricId: "usage.feature_adoption.rate", displayName: "Adoção de funcionalidade", definitionStatus: "pending_semantics" },
  { category: "engagement", metricId: "usage.engagement.events", displayName: "Eventos de engajamento", definitionStatus: "implemented" },
  { category: "revenue", metricId: "billing.gross_billed", displayName: "Faturamento bruto emitido", definitionStatus: "implemented" },
  { category: "revenue", metricId: "revenue.cash_collected", displayName: "Caixa recebido", definitionStatus: "implemented" },
  { category: "revenue", metricId: "subscription.active.count", displayName: "Assinaturas ativas", definitionStatus: "implemented" },
  { category: "revenue", metricId: "revenue.mrr", displayName: "Receita recorrente mensal (MRR)", definitionStatus: "pending_semantics" },
  { category: "revenue", metricId: "revenue.arr", displayName: "Receita recorrente anual (ARR)", definitionStatus: "pending_semantics" },
  { category: "churn", metricId: "subscription.cancelled.count", displayName: "Cancelamentos", definitionStatus: "implemented" },
  { category: "churn", metricId: "subscription.logo_churn.rate", displayName: "Taxa de cancelamento de clientes", definitionStatus: "pending_semantics" },
  { category: "health", metricId: "incident.count", displayName: "Incidentes", definitionStatus: "implemented" },
  { category: "health", metricId: "service.error.rate", displayName: "Taxa de erro", definitionStatus: "pending_semantics" },
  { category: "health", metricId: "support.ticket.open.count", displayName: "Chamados de suporte abertos", definitionStatus: "implemented" },
] as const;

export const PRODUCT_GROWTH_METRICS = [
  "trial.starts.count",
  "subscription.active.count",
  "billing.gross_billed",
  "revenue.cash_collected",
] as const;
