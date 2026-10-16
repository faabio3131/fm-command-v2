import { and, eq, inArray, max } from "drizzle-orm";
import type { PulseParts } from "@/domain/live/pulse";
import type { UnitScope } from "@/domain/organization/unit-hierarchy";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { metricValues } from "@/infrastructure/db/platform-schema";

/**
 * Duas leituras de máximo, ambas por índice. Mesma regra de escopo da linha do tempo de atividades:
 * valor de métrica por unidade; evento de auditoria (sem unidade) só para quem enxerga tudo.
 */
export class PostgresLivePulseRepository {
  async read(tenantId: string, scope: UnitScope): Promise<PulseParts> {
    const metricScope = scope.kind === "all" ? undefined : inArray(metricValues.unitId, [...scope.unitIds]);
    const emptyScope = scope.kind === "units" && scope.unitIds.size === 0;
    const [metrics, audit] = await Promise.all([
      emptyScope
        ? Promise.resolve([{ latest: null as Date | null }])
        : db.select({ latest: max(metricValues.computedAt) }).from(metricValues)
            .where(and(eq(metricValues.tenantId, tenantId), metricScope)),
      scope.kind === "all"
        ? db.select({ latest: max(auditEvents.occurredAt) }).from(auditEvents).where(eq(auditEvents.tenantId, tenantId))
        : Promise.resolve([{ latest: null as Date | null }]),
    ]);
    return { metricsLatest: metrics[0]?.latest?.getTime() ?? null, auditLatest: audit[0]?.latest?.getTime() ?? null };
  }
}
