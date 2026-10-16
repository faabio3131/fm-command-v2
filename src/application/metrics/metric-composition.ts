import { MetricRecomputeService } from "@/application/metrics/metric-recompute-service";
import { MetricService } from "@/application/metrics/metric-service";
import { UnitComparisonService } from "@/application/metrics/unit-comparison-service";
import { createUnitScopeResolver } from "@/application/organization/unit-scope";
import { PostgresProfileRepository } from "@/infrastructure/i18n/postgres-profile-repository";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";

/**
 * UNICA porta de entrada para montar o MetricService (ADR-019). Sempre com o escopo de unidades da pessoa que consulta.
 * Montar `new MetricService(...)` em outro lugar e proibido por teste (tests/metric-service-composition.unit.test.ts).
 */
export function createMetricService(): MetricService {
  return new MetricService(new PostgresMetricStore(), createUnitScopeResolver());
}

/** Comparação entre filiais: usa a mesma porta única do MetricService, com o mesmo escopo. */
export function createUnitComparisonService(): UnitComparisonService {
  const repository = new PostgresUnitRepository();
  const scope = createUnitScopeResolver(repository);
  return new UnitComparisonService(
    new MetricService(new PostgresMetricStore(), scope),
    (tenantId) => repository.listUnits(tenantId),
    scope,
  );
}

/** Recálculo de métricas a partir dos fatos (depois de cada sincronização e por agendamento). */
export function createMetricRecomputeService(): MetricRecomputeService {
  const store = new PostgresMetricStore();
  return new MetricRecomputeService({
    metrics: createMetricService(),
    factScopes: (tenantId) => store.distinctFactScopes(tenantId),
    tenantIds: () => store.tenantIdsWithFacts(),
    timeZone: async (tenantId) => {
      try { return (await new PostgresProfileRepository().getOrgProfile(tenantId))?.timezone ?? "UTC"; } catch { return "UTC"; }
    },
  });
}
