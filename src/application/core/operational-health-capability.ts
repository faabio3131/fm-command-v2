import type { OperationalHealthService } from "@/application/operations/operational-health-service";
import type { CoreReadCapability, CoreReadCapabilityResult } from "@/domain/core/read-capability";
import type { TenantContext } from "@/domain/security/tenant-context";

export class OperationalHealthCapability implements CoreReadCapability {
  readonly descriptor = {
    id: "operations.health_summary",
    displayName: "Saúde operacional",
    description: "Estado governado dos serviços monitorados, com atualidade e proveniência.",
  } as const;

  constructor(private readonly health: OperationalHealthService) {}

  async read(context: TenantContext): Promise<CoreReadCapabilityResult> {
    const overview = await this.health.overview(context);
    const observed = overview.services.filter(({ observation }) => observation !== null);
    if (!observed.length) {
      return { status: "unavailable", evidence: { kind: "source", ref: "operational-health" } };
    }

    const provenanceRefs = [
      ...new Set(
        observed.flatMap(({ observation }) => observation?.provenanceRefs ?? []),
      ),
    ];
    if (!provenanceRefs.length) {
      return { status: "unavailable", evidence: { kind: "source", ref: "operational-health" } };
    }

    return {
      status: "available",
      fact: {
        services: observed.map(({ service, observation, effectiveStatus }) => ({
          name: service.name,
          productId: service.productId ?? null,
          environment: service.environment,
          status: effectiveStatus,
          observedStatus: observation?.status ?? null,
          freshnessStatus: observation?.freshnessStatus ?? "unknown",
          observedAt: observation?.observedAt.toISOString(),
          latencyP95Ms: observation?.latencyP95Ms ?? null,
          errorRate: observation?.errorRate ?? null,
        })),
        counts: overview.counts,
        consolidatedAvailability: null,
      },
      evidence: {
        kind: "source",
        ref: "operational-health",
        sourceAuthority: "fmcc_operational_health",
        freshnessStatus: observed.some(
          ({ observation }) => observation?.freshnessStatus === "stale",
        )
          ? "stale"
          : "source-governed",
        qualityStatus: "governed",
        provenanceRefs,
      },
    };
  }
}
