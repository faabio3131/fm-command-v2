import type { MetricService } from "@/application/metrics/metric-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { CUSTOMER_INTELLIGENCE_TARGETS, type CustomerMetricState } from "@/domain/customer/intelligence";
import { getMetricDefinition } from "@/domain/metrics/registry";
import type { ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

export class CustomerIntelligenceService {
  private readonly products?: ProductRegistryService;

  constructor(
    private readonly metrics: MetricService,
    products?: ProductRepository,
  ) {
    this.products = products ? new ProductRegistryService(products) : undefined;
  }

  async overview(context: TenantContext, productId?: string) {
    if (productId && this.products) await this.products.get(context, productId);

    const metrics = await Promise.all(CUSTOMER_INTELLIGENCE_TARGETS.map(async (target) => {
      const definition = getMetricDefinition(target.metricId);
      if (!definition) {
        return { target, status: "pending_semantics" as CustomerMetricState, value: null };
      }
      const value = await this.metrics.query(context, target.metricId, productId);
      return {
        target,
        status: value?.value !== null && value ? "available" as CustomerMetricState : "unavailable" as CustomerMetricState,
        value,
      };
    }));

    const factualSignals = metrics
      .filter((item) => item.status === "available" && item.value !== null)
      .map((item) => ({
        metricId: item.target.metricId,
        displayName: item.target.displayName,
        value: item.value?.value ?? null,
        unit: item.value?.unit ?? "count",
        freshnessStatus: item.value?.freshnessStatus ?? "unknown",
        qualityStatus: item.value?.qualityStatus ?? "unknown",
        provenanceRefs: item.value?.provenanceRefs ?? [],
      }));

    return {
      productId,
      metrics,
      factualSignals,
      customerRisk: {
        status: "pending_semantics" as const,
        score: null,
        reason: "Não existe identidade customer-level, threshold aprovado e modelo explicável suficiente para classificar cliente em risco.",
      },
      adoption: {
        status: "pending_semantics" as const,
        reason: "Adoção exige evento de ativação/uso e denominador elegível formalmente definidos.",
      },
      privacy: {
        surface: "aggregate_only" as const,
        note: "A superfície retorna somente agregados governados; fatos brutos e PII não são expostos pela API de inteligência.",
      },
    };
  }
}
