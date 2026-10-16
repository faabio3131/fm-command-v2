export type OperationsMetricState = "available" | "unavailable" | "pending_semantics";

export interface OperationsMetricTarget {
  readonly metricId: string;
  readonly displayName: string;
  readonly definitionStatus: "implemented" | "pending_semantics";
}

export const OPERATIONS_METRIC_TARGETS: readonly OperationsMetricTarget[] = [
  { metricId: "incident.count", displayName: "Incidentes", definitionStatus: "implemented" },
  { metricId: "job.failure.count", displayName: "Falhas de jobs", definitionStatus: "implemented" },
  { metricId: "integration.failure.count", displayName: "Falhas de integrações", definitionStatus: "implemented" },
  { metricId: "service.error.count", displayName: "Erros de serviço", definitionStatus: "implemented" },
  { metricId: "service.error.rate", displayName: "Taxa de erro", definitionStatus: "pending_semantics" },
  { metricId: "service.availability.rate", displayName: "Disponibilidade", definitionStatus: "pending_semantics" },
  { metricId: "infrastructure.consumption", displayName: "Consumo de infraestrutura", definitionStatus: "pending_semantics" },
] as const;
