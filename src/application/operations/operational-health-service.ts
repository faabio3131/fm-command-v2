import { ProductRegistryService } from "@/application/products/product-registry-service";
import type { OperationalHealthRepository, ServiceHealthObservation } from "@/domain/operations/health";
import type { ProductRepository } from "@/domain/products/contracts";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

function effectiveStatus(
  observation: ServiceHealthObservation | null,
): "operational" | "degraded" | "unavailable" | "unknown" {
  if (!observation || observation.freshnessStatus === "stale") return "unknown";
  return observation.status;
}

export class OperationalHealthService {
  private readonly products?: ProductRegistryService;

  constructor(
    private readonly repository: OperationalHealthRepository,
    products?: ProductRepository,
  ) {
    this.products = products ? new ProductRegistryService(products) : undefined;
  }

  async overview(context: TenantContext, productId?: string) {
    requirePermission(context, "metric:read");
    if (productId && this.products) await this.products.get(context, productId);

    const allServices = await this.repository.listServices(context.tenantId);
    const services = productId
      ? allServices.filter((service) => service.productId === productId)
      : allServices;

    const entries = await Promise.all(
      services.map(async (service) => {
        const observation = await this.repository.latestObservation(
          context.tenantId,
          service.id,
        );
        return {
          service,
          observation,
          effectiveStatus: effectiveStatus(observation),
        };
      }),
    );

    return {
      productId,
      services: entries,
      counts: {
        operational: entries.filter(({ effectiveStatus }) => effectiveStatus === "operational").length,
        degraded: entries.filter(({ effectiveStatus }) => effectiveStatus === "degraded").length,
        unavailable: entries.filter(({ effectiveStatus }) => effectiveStatus === "unavailable").length,
        unknown: entries.filter(({ effectiveStatus }) => effectiveStatus === "unknown").length,
      },
      availability: {
        value: null as string | null,
        reason: "Disponibilidade consolidada exige política de janela e denominador aprovados.",
      },
    };
  }

  async registerService(context: TenantContext, input: {
    productId?: string;
    name: string;
    serviceType: string;
    authority: string;
    environment: string;
    expectedHealthContract: string;
  }) {
    requirePermission(context, "integration:write");
    if (input.productId && this.products) await this.products.get(context, input.productId);
    if (
      !input.name.trim() ||
      !input.serviceType.trim() ||
      !input.authority.trim() ||
      !input.environment.trim() ||
      !input.expectedHealthContract.trim()
    ) {
      throw new Error("operations.service_definition_invalid");
    }
    return this.repository.createService(context.tenantId, input);
  }

  async recordObservation(context: TenantContext, input: ServiceHealthObservation) {
    requirePermission(context, "integration:write");
    const services = await this.repository.listServices(context.tenantId);
    if (!services.some((service) => service.id === input.serviceId)) {
      throw new Error("operations.service_not_found");
    }
    if (!input.sourceAuthority.trim() || input.provenanceRefs.length < 1) {
      throw new Error("operations.health_evidence_required");
    }
    await this.repository.recordObservation(context.tenantId, input);
  }
}
