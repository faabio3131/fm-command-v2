import type { MetricService } from "@/application/metrics/metric-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { GROWTH_METRIC_TARGETS, type GrowthMetricState } from "@/domain/growth/intelligence";
import { getMetricDefinition } from "@/domain/metrics/registry";
import type { ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

export class GrowthIntelligenceService {
  private readonly products?: ProductRegistryService;

  constructor(
    private readonly metrics: MetricService,
    products?: ProductRepository,
  ) {
    this.products = products ? new ProductRegistryService(products) : undefined;
  }

  async overview(context: TenantContext, productId?: string) {
    if (productId && this.products) await this.products.get(context, productId);

    const metrics = await Promise.all(GROWTH_METRIC_TARGETS.map(async (target) => {
      const definition = getMetricDefinition(target.metricId);
      if (!definition) return { target, status: "pending_semantics" as GrowthMetricState, value: null };
      const value = await this.metrics.query(context, target.metricId, productId);
      return {
        target,
        status: value?.value !== null && value ? "available" as GrowthMetricState : "unavailable" as GrowthMetricState,
        value,
      };
    }));

    return {
      productId,
      metrics,
      attribution: {
        status: "pending_semantics" as const,
        reason: "Nenhuma regra de atribuição comercial canônica foi aprovada no CURRENT.",
      },
      funnel: {
        status: "pending_semantics" as const,
        reason: "Conversão exige coorte, população e janela temporal governadas.",
      },
    };
  }
}
