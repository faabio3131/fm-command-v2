import type { UnitScopeResolver } from "@/application/metrics/metric-service";
import type { UnitScope } from "@/domain/organization/unit-hierarchy";
import type { TenantContext } from "@/domain/security/tenant-context";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

/**
 * Resolvedor de escopo de unidades (ADR-019) usado por TODA leitura de metricas e de fatos.
 * O resultado fica guardado pelo objeto de contexto: um contexto vale uma requisicao, entao o mesmo pedido consulta o banco uma vez
 * e a proxima requisicao (contexto novo) ja enxerga concessoes revogadas.
 */
export function createUnitScopeResolver(repository: Pick<PostgresUnitRepository, "scopeFor"> = new PostgresUnitRepository()): UnitScopeResolver {
  const cache = new WeakMap<TenantContext, Promise<UnitScope>>();
  return (context) => {
    let hit = cache.get(context);
    if (!hit) {
      hit = repository.scopeFor(context);
      cache.set(context, hit);
      // Falha nao fica guardada: a proxima chamada tenta de novo.
      hit.catch(() => cache.delete(context));
    }
    return hit;
  };
}
