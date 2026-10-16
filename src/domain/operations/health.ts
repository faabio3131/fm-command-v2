export type ServiceHealthStatus = "operational" | "degraded" | "unavailable" | "unknown";
export type ServiceHealthFreshness = "fresh" | "delayed" | "stale" | "unknown";

export interface MonitoredService {
  readonly id: string;
  readonly tenantId: string;
  readonly productId?: string;
  readonly name: string;
  readonly serviceType: string;
  readonly authority: string;
  readonly environment: string;
  readonly expectedHealthContract: string;
}

export interface ServiceHealthObservation {
  readonly serviceId: string;
  readonly observedAt: Date;
  readonly status: ServiceHealthStatus;
  readonly availability?: string;
  readonly latencyP95Ms?: number;
  readonly errorRate?: string;
  readonly sourceAuthority: string;
  readonly freshnessStatus: ServiceHealthFreshness;
  readonly provenanceRefs: readonly string[];
}

export interface OperationalHealthRepository {
  listServices(tenantId: string): Promise<readonly MonitoredService[]>;
  latestObservation(tenantId: string, serviceId: string): Promise<ServiceHealthObservation | null>;
  createService(tenantId: string, input: Omit<MonitoredService, "id" | "tenantId">): Promise<MonitoredService>;
  recordObservation(tenantId: string, input: ServiceHealthObservation): Promise<void>;
}
