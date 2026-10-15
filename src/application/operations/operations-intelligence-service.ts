import type { MetricService } from "@/application/metrics/metric-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { getMetricDefinition } from "@/domain/metrics/registry";
import { OPERATIONS_METRIC_TARGETS, type OperationsMetricState } from "@/domain/operations/intelligence";
import type { ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

export class OperationsIntelligenceService {
  private readonly products?: ProductRegistryService;

  constructor(
    private readonly metrics: MetricService,
    products?: ProductRepository,
  ) {
    this.products = products ? new ProductRegistryService(products) : undefined;
  }

  async overview(context: TenantContext, productId?: string) {
    if (productId && this.products) await this.products.get(context, productId);

    const metrics = await Promise.all(OPERATIONS_METRIC_TARGETS.map(async (target) => {
      const definition = getMetricDefinition(target.metricId);
      if (!definition) return { target, status: "pending_semantics" as OperationsMetricState, value: null };
      const value = await this.metrics.query(context, target.metricId, productId);
      return {
        target,
        status: value?.value !== null && value ? "available" as OperationsMetricState : "unavailable" as OperationsMetricState,
        value,
      };
    }));

    return {
      productId,
      metrics,
      runtime: {
        healthEndpoint: "/api/health",
        readinessEndpoint: "/api/ready",
        healthStatus: "endpoint_available" as const,
        readinessStatus: "endpoint_available" as const,
      },
      availability: {
        status: "pending_semantics" as const,
        reason: "Percentual de disponibilidade exige série temporal e denominador aprovados; health/readiness pontual não é uptime.",
      },
      alerts: {
        status: "signals_only" as const,
        reason: "F14 expõe sinais operacionais; alertas proativos/workflows pertencem à F17.",
      },
    };
  }
}
