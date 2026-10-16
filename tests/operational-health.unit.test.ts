import { describe, expect, it } from "vitest";
import { OperationalHealthCapability } from "@/application/core/operational-health-capability";
import { OperationalHealthService } from "@/application/operations/operational-health-service";
import type {
  MonitoredService,
  OperationalHealthRepository,
  ServiceHealthObservation,
} from "@/domain/operations/health";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  role: "owner",
  correlationId: "corr-a",
};

function repository(input?: {
  services?: MonitoredService[];
  observations?: ServiceHealthObservation[];
}): OperationalHealthRepository {
  const services = input?.services ?? [];
  const observations = input?.observations ?? [];
  return {
    listServices: async (tenantId) =>
      services.filter((service) => service.tenantId === tenantId),
    latestObservation: async (tenantId, serviceId) =>
      observations
        .filter(
          (observation) =>
            observation.serviceId === serviceId &&
            services.some(
              (service) =>
                service.id === serviceId && service.tenantId === tenantId,
            ),
        )
        .sort(
          (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
        )[0] ?? null,
    createService: async (tenantId, service) => ({
      id: "created",
      tenantId,
      ...service,
    }),
    recordObservation: async () => undefined,
  };
}

const service: MonitoredService = {
  id: "svc-1",
  tenantId: "tenant-a",
  name: "FM Command",
  serviceType: "saas",
  authority: "fmcc_runtime",
  environment: "preview",
  expectedHealthContract: "/api/health",
};

const observation: ServiceHealthObservation = {
  serviceId: "svc-1",
  observedAt: new Date("2026-10-02T20:00:00Z"),
  status: "operational",
  sourceAuthority: "fmcc_runtime",
  freshnessStatus: "fresh",
  provenanceRefs: ["health:preview:1"],
};

describe("CME-03 operational health", () => {
  it("mantém serviço sem observação como unknown e não fabrica uptime", async () => {
    const overview = await new OperationalHealthService(
      repository({ services: [service] }),
    ).overview(context);
    expect(overview.counts.unknown).toBe(1);
    expect(overview.counts.operational).toBe(0);
    expect(overview.availability.value).toBeNull();
  });

  it("separa observação governada do status de source/connectividade", async () => {
    const overview = await new OperationalHealthService(
      repository({ services: [service], observations: [observation] }),
    ).overview(context);
    expect(overview.counts.operational).toBe(1);
    expect(overview.services[0].effectiveStatus).toBe("operational");
    expect(overview.services[0].observation?.sourceAuthority).toBe("fmcc_runtime");
    expect(overview.services[0].observation?.provenanceRefs).toEqual([
      "health:preview:1",
    ]);
  });

  it("trata observação stale como unknown, nunca como saudável", async () => {
    const stale: ServiceHealthObservation = {
      ...observation,
      freshnessStatus: "stale",
    };
    const overview = await new OperationalHealthService(
      repository({ services: [service], observations: [stale] }),
    ).overview(context);
    expect(overview.counts.operational).toBe(0);
    expect(overview.counts.unknown).toBe(1);
    expect(overview.services[0].effectiveStatus).toBe("unknown");
  });

  it("mantém isolamento por tenant na autoridade de saúde", async () => {
    const foreignService: MonitoredService = {
      ...service,
      id: "svc-foreign",
      tenantId: "tenant-b",
      name: "Foreign",
    };
    const overview = await new OperationalHealthService(
      repository({ services: [service, foreignService] }),
    ).overview(context);
    expect(overview.services).toHaveLength(1);
    expect(overview.services[0].service.id).toBe("svc-1");
  });

  it("recusa observação sem serviço do tenant atual", async () => {
    const health = new OperationalHealthService(repository({ services: [service] }));
    await expect(
      health.recordObservation(context, {
        ...observation,
        serviceId: "svc-missing",
      }),
    ).rejects.toThrow("operations.service_not_found");
  });

  it("exige proveniência para observação de saúde", async () => {
    const health = new OperationalHealthService(repository({ services: [service] }));
    await expect(
      health.recordObservation(context, {
        ...observation,
        provenanceRefs: [],
      }),
    ).rejects.toThrow("operations.health_evidence_required");
  });

  it("expõe a mesma autoridade ao Core com evidência", async () => {
    const health = new OperationalHealthService(
      repository({ services: [service], observations: [observation] }),
    );
    const result = await new OperationalHealthCapability(health).read(context);
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.evidence.sourceAuthority).toBe("fmcc_operational_health");
      expect(result.evidence.provenanceRefs).toContain("health:preview:1");
      expect(result.fact.services).toEqual([
        expect.objectContaining({
          name: "FM Command",
          status: "operational",
          freshnessStatus: "fresh",
        }),
      ]);
    }
  });
});
