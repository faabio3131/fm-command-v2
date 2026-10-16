import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { computeOperatingResult } from "@/domain/finance/operating-result";
import { FINANCIAL_METRIC_TARGETS, UNIT_ECONOMICS_TARGETS } from "@/domain/finance/intelligence";
import { getMetricDefinition } from "@/domain/metrics/registry";
import type { ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

type MetricState = "available" | "unavailable" | "pending_semantics";

export class FinancialIntelligenceService {
  private readonly products?: ProductRegistryService;

  constructor(
    private readonly metrics: MetricService,
    products?: ProductRepository,
  ) {
    this.products = products ? new ProductRegistryService(products) : undefined;
  }

  async overview(context: TenantContext, productId?: string) {
    if (productId && this.products) await this.products.get(context, productId);

    const metrics = await Promise.all(FINANCIAL_METRIC_TARGETS.map(async (target) => {
      const definition = getMetricDefinition(target.metricId);
      if (!definition) {
        return { target, status: "pending_semantics" as MetricState, value: null };
      }
      const value = await this.metrics.query(context, target.metricId, productId);
      return {
        target,
        status: value?.value !== null && value ? "available" as MetricState : "unavailable" as MetricState,
        value,
      };
    }));

    const byId = new Map(metrics.map((item) => [item.target.metricId, item.value] as const));
    const operatingResult = computeOperatingResult(
      byId.get("revenue.cash_collected") ?? null,
      byId.get("cost.infrastructure.total") ?? null,
      byId.get("cost.operating.total") ?? null,
    );

    return {
      productId,
      metrics,
      operatingResult,
      unitEconomics: UNIT_ECONOMICS_TARGETS.map((target) => ({
        target,
        status: "pending_semantics" as const,
        value: null,
      })),
    };
  }

  static metricViewToInput(value: MetricView | null) {
    return value;
  }
}
