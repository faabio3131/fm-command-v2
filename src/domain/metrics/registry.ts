export type MetricKind = "count" | "sum";
export type MetricGrain = "period" | "as_of";

export interface MetricDefinition {
  readonly metricId: string;
  readonly version: number;
  readonly calculationVersion: string;
  readonly displayName: string;
  readonly description: string;
  readonly kind: MetricKind;
  readonly factType: string;
  readonly valueField?: string;
  readonly unit: "count" | "currency" | "percent";
  readonly currencyField?: string;
  readonly grain: MetricGrain;
  readonly dimensions: readonly string[];
  readonly timeWindow: "bounded_period" | "as_of";
  readonly freshnessPolicy: "source_governed";
  readonly sourceAuthority: string;
}

export const METRIC_REGISTRY: readonly MetricDefinition[] = [
  {
    metricId: "trial.starts.count", version: 1, calculationVersion: "v1",
    displayName: "Testes gratuitos iniciados", description: "Testes gratuitos distintos iniciados no período.",
    kind: "count", factType: "trial.started", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_trial_source",
  },
  {
    metricId: "subscription.active.count", version: 1, calculationVersion: "v1",
    displayName: "Assinaturas ativas", description: "Assinaturas distintas em estado comercial ativo conforme a fonte governada.",
    kind: "count", factType: "subscription.active", unit: "count", grain: "as_of", dimensions: [],
    timeWindow: "as_of", freshnessPolicy: "source_governed", sourceAuthority: "configured_billing_source",
  },
  {
    metricId: "subscription.cancelled.count", version: 1, calculationVersion: "v1",
    displayName: "Cancelamentos", description: "Assinaturas com cancelamento efetivo no período.",
    kind: "count", factType: "subscription.cancelled", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_billing_source",
  },
  {
    metricId: "billing.gross_billed", version: 1, calculationVersion: "v1",
    displayName: "Faturamento bruto emitido", description: "Soma de cobranças ou faturas válidas emitidas no período, antes do recebimento.",
    kind: "sum", factType: "billing.invoice", valueField: "amount", unit: "currency", currencyField: "currency",
    grain: "period", dimensions: ["currency"], timeWindow: "bounded_period", freshnessPolicy: "source_governed",
    sourceAuthority: "configured_billing_source",
  },
  {
    metricId: "revenue.cash_collected", version: 1, calculationVersion: "v1",
    displayName: "Caixa recebido", description: "Pagamentos efetivamente liquidados no período.",
    kind: "sum", factType: "payment.settled", valueField: "amount", unit: "currency", currencyField: "currency",
    grain: "period", dimensions: ["currency"], timeWindow: "bounded_period", freshnessPolicy: "source_governed",
    sourceAuthority: "configured_payment_source",
  },
  {
    metricId: "receivable.delinquent_amount", version: 1, calculationVersion: "v1",
    displayName: "Inadimplência", description: "Soma de valores vencidos marcados como inadimplentes pela fonte financeira autorizada.",
    kind: "sum", factType: "receivable.delinquent", valueField: "amount", unit: "currency", currencyField: "currency",
    grain: "period", dimensions: ["currency"], timeWindow: "bounded_period", freshnessPolicy: "source_governed",
    sourceAuthority: "configured_receivables_source",
  },
  {
    metricId: "cost.infrastructure.total", version: 1, calculationVersion: "v1",
    displayName: "Custos de infraestrutura", description: "Custos de infraestrutura efetivamente reportados por fonte autorizada.",
    kind: "sum", factType: "cost.infrastructure", valueField: "amount", unit: "currency", currencyField: "currency",
    grain: "period", dimensions: ["currency"], timeWindow: "bounded_period", freshnessPolicy: "source_governed",
    sourceAuthority: "configured_infrastructure_cost_source",
  },
  {
    metricId: "cost.operating.total", version: 1, calculationVersion: "v1",
    displayName: "Custos operacionais rastreáveis", description: "Custos operacionais rastreáveis reportados por fonte autorizada.",
    kind: "sum", factType: "cost.operating", valueField: "amount", unit: "currency", currencyField: "currency",
    grain: "period", dimensions: ["currency"], timeWindow: "bounded_period", freshnessPolicy: "source_governed",
    sourceAuthority: "configured_operating_cost_source",
  },
  {
    metricId: "lead.created.count", version: 1, calculationVersion: "v1",
    displayName: "Leads criados", description: "Leads distintos criados no período por fonte comercial autorizada.",
    kind: "count", factType: "lead.created", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_lead_source",
  },
  {
    metricId: "incident.count", version: 1, calculationVersion: "v1",
    displayName: "Incidentes", description: "Incidentes distintos abertos no período por fonte operacional autorizada.",
    kind: "count", factType: "incident.opened", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_incident_source",
  },
  {
    metricId: "job.failure.count", version: 1, calculationVersion: "v1",
    displayName: "Falhas de jobs", description: "Jobs distintos que falharam no período por fonte operacional autorizada.",
    kind: "count", factType: "job.failed", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_job_source",
  },
  {
    metricId: "integration.failure.count", version: 1, calculationVersion: "v1",
    displayName: "Falhas de integrações", description: "Execuções de integração distintas que falharam no período.",
    kind: "count", factType: "integration.failed", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_integration_source",
  },
  {
    metricId: "service.error.count", version: 1, calculationVersion: "v1",
    displayName: "Erros de serviço", description: "Erros de serviço distintos registrados no período por telemetria autorizada.",
    kind: "count", factType: "service.error", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_observability_source",
  },
  {
    metricId: "usage.active_users.dau", version: 1, calculationVersion: "v1",
    displayName: "Usuários ativos diários (DAU)", description: "Usuários distintos com atividade governada dentro do período diário consultado.",
    kind: "count", factType: "usage.active_user.day", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_usage_source",
  },
  {
    metricId: "usage.engagement.events", version: 1, calculationVersion: "v1",
    displayName: "Eventos de engajamento", description: "Eventos de engajamento distintos reportados pela telemetria de produto autorizada.",
    kind: "count", factType: "usage.engagement_event", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_usage_source",
  },
  {
    metricId: "support.ticket.open.count", version: 1, calculationVersion: "v1",
    displayName: "Chamados de suporte abertos", description: "Chamados distintos abertos no período por fonte de suporte autorizada.",
    kind: "count", factType: "support.ticket.opened", unit: "count", grain: "period", dimensions: [],
    timeWindow: "bounded_period", freshnessPolicy: "source_governed", sourceAuthority: "configured_support_source",
  },
] as const;

export function getMetricDefinition(metricId: string): MetricDefinition | null {
  return METRIC_REGISTRY.find((item) => item.metricId === metricId) ?? null;
}


export interface ExecutiveMetricTarget {
  readonly metricId: string;
  readonly displayName: string;
  readonly definitionStatus: "implemented" | "pending_semantics";
}

export const EXECUTIVE_METRIC_TARGETS: readonly ExecutiveMetricTarget[] = [
  { metricId: "trial.starts.count", displayName: "Testes gratuitos iniciados", definitionStatus: "implemented" },
  { metricId: "trial.active.count", displayName: "Testes gratuitos ativos", definitionStatus: "pending_semantics" },
  { metricId: "trial.conversion.rate", displayName: "Conversão de teste gratuito → assinatura", definitionStatus: "pending_semantics" },
  { metricId: "subscription.active.count", displayName: "Assinaturas ativas", definitionStatus: "implemented" },
  { metricId: "subscription.cancelled.count", displayName: "Cancelamentos", definitionStatus: "implemented" },
  { metricId: "subscription.logo_churn.rate", displayName: "Taxa de cancelamento de clientes", definitionStatus: "pending_semantics" },
  { metricId: "revenue.mrr", displayName: "Receita recorrente mensal (MRR)", definitionStatus: "pending_semantics" },
  { metricId: "revenue.arr", displayName: "Receita recorrente anual (ARR)", definitionStatus: "pending_semantics" },
  { metricId: "billing.gross_billed", displayName: "Faturamento bruto emitido", definitionStatus: "implemented" },
  { metricId: "revenue.cash_collected", displayName: "Caixa recebido", definitionStatus: "implemented" },
  { metricId: "receivable.delinquent_amount", displayName: "Inadimplência", definitionStatus: "implemented" },
  { metricId: "cost.infrastructure.total", displayName: "Custos de infraestrutura", definitionStatus: "implemented" },
  { metricId: "cost.operating.total", displayName: "Custos operacionais rastreáveis", definitionStatus: "implemented" },
  { metricId: "finance.operating_result", displayName: "Resultado operacional", definitionStatus: "pending_semantics" },
  { metricId: "finance.operating_margin.rate", displayName: "Margem operacional", definitionStatus: "pending_semantics" },
  { metricId: "lead.created.count", displayName: "Leads criados", definitionStatus: "implemented" },
  { metricId: "incident.count", displayName: "Incidentes", definitionStatus: "implemented" },
  { metricId: "job.failure.count", displayName: "Falhas de jobs", definitionStatus: "implemented" },
  { metricId: "integration.failure.count", displayName: "Falhas de integrações", definitionStatus: "implemented" },
  { metricId: "service.error.count", displayName: "Erros de serviço", definitionStatus: "implemented" },
  { metricId: "service.error.rate", displayName: "Taxa de erro", definitionStatus: "pending_semantics" },
  { metricId: "usage.active_users.dau", displayName: "Usuários ativos diários (DAU)", definitionStatus: "implemented" },
  { metricId: "usage.engagement.events", displayName: "Eventos de engajamento", definitionStatus: "implemented" },
  { metricId: "support.ticket.open.count", displayName: "Chamados de suporte abertos", definitionStatus: "implemented" },
] as const;
