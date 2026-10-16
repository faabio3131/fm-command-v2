import { MetricService } from "@/application/metrics/metric-service";
import { createUnitScopeResolver } from "@/application/organization/unit-scope";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";

/**
 * UNICA porta de entrada para montar o MetricService (ADR-019). Sempre com o escopo de unidades da pessoa que consulta.
 * Montar `new MetricService(...)` em outro lugar e proibido por teste (tests/metric-service-composition.unit.test.ts).
 */
export function createMetricService(): MetricService {
  return new MetricService(new PostgresMetricStore(), createUnitScopeResolver());
}
