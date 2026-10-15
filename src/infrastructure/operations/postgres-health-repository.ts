import { and, desc, eq } from "drizzle-orm";
import type { MonitoredService, OperationalHealthRepository, ServiceHealthObservation } from "@/domain/operations/health";
import { db } from "@/infrastructure/db/client";
import { monitoredServices, serviceHealthObservations } from "@/infrastructure/db/platform-schema";

function mapService(row: typeof monitoredServices.$inferSelect): MonitoredService {
  return {
    id: row.id,
    tenantId: row.tenantId,
    productId: row.productId ?? undefined,
    name: row.name,
    serviceType: row.serviceType,
    authority: row.authority,
    environment: row.environment,
    expectedHealthContract: row.expectedHealthContract,
  };
}

export class PostgresOperationalHealthRepository implements OperationalHealthRepository {
  async listServices(tenantId: string): Promise<readonly MonitoredService[]> {
    const rows = await db.select().from(monitoredServices).where(eq(monitoredServices.tenantId, tenantId));
    return rows.map(mapService);
  }

  async latestObservation(tenantId: string, serviceId: string): Promise<ServiceHealthObservation | null> {
    const rows = await db.select().from(serviceHealthObservations).where(and(
      eq(serviceHealthObservations.tenantId, tenantId),
      eq(serviceHealthObservations.serviceId, serviceId),
    )).orderBy(desc(serviceHealthObservations.observedAt)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      serviceId: row.serviceId,
      observedAt: row.observedAt,
      status: row.status as ServiceHealthObservation["status"],
      availability: row.availability ?? undefined,
      latencyP95Ms: row.latencyP95Ms ?? undefined,
      errorRate: row.errorRate ?? undefined,
      sourceAuthority: row.sourceAuthority,
      freshnessStatus: row.freshnessStatus as ServiceHealthObservation["freshnessStatus"],
      provenanceRefs: row.provenanceRefs,
    };
  }

  async createService(tenantId: string, input: Omit<MonitoredService, "id" | "tenantId">): Promise<MonitoredService> {
    const rows = await db.insert(monitoredServices).values({ tenantId, ...input }).returning();
    return mapService(rows[0]);
  }

  async recordObservation(tenantId: string, input: ServiceHealthObservation): Promise<void> {
    await db.insert(serviceHealthObservations).values({
      tenantId,
      serviceId: input.serviceId,
      observedAt: input.observedAt,
      status: input.status,
      availability: input.availability,
      latencyP95Ms: input.latencyP95Ms,
      errorRate: input.errorRate,
      sourceAuthority: input.sourceAuthority,
      freshnessStatus: input.freshnessStatus,
      provenanceRefs: [...input.provenanceRefs],
    });
  }
}
