import type { AlertService } from "@/application/alerts/alert-service";
import type { CustomerIntelligenceService } from "@/application/customer/customer-intelligence-service";
import type { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import type { GrowthIntelligenceService } from "@/application/growth/growth-intelligence-service";
import type { OperationalHealthService } from "@/application/operations/operational-health-service";
import type { OperationsIntelligenceService } from "@/application/operations/operations-intelligence-service";
import type { ProductIntelligenceService } from "@/application/products/product-intelligence-service";
import type { SourceRepository } from "@/domain/integration/contracts";
import {
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";

type ProductOverviewReader = Pick<ProductIntelligenceService, "overview">;
type GrowthOverviewReader = Pick<GrowthIntelligenceService, "overview">;
type FinancialOverviewReader = Pick<FinancialIntelligenceService, "overview">;
type CustomerOverviewReader = Pick<CustomerIntelligenceService, "overview">;
type OperationsOverviewReader = Pick<OperationsIntelligenceService, "overview">;
type HealthOverviewReader = Pick<OperationalHealthService, "overview">;
type AlertOverviewReader = Pick<AlertService, "overview">;
type SourceReader = Pick<SourceRepository, "list">;

export class ProductCockpitService {
  constructor(
    private readonly productIntelligence: ProductOverviewReader,
    private readonly growth: GrowthOverviewReader,
    private readonly finance: FinancialOverviewReader,
    private readonly customer: CustomerOverviewReader,
    private readonly operations: OperationsOverviewReader,
    private readonly health: HealthOverviewReader,
    private readonly alerts: AlertOverviewReader,
    private readonly sources: SourceReader,
  ) {}

  async overview(context: TenantContext, productId: string) {
    requirePermission(context, "integration:read");

    const [
      productIntelligence,
      commercial,
      finance,
      customer,
      operations,
      health,
      alertOverview,
      sourceDefinitions,
    ] = await Promise.all([
      this.productIntelligence.overview(context, productId),
      this.growth.overview(context, productId),
      this.finance.overview(context, productId),
      this.customer.overview(context, productId),
      this.operations.overview(context, productId),
      this.health.overview(context, productId),
      this.alerts.overview(context),
      this.sources.list(context.tenantId),
    ]);

    const productRules = alertOverview.rules.filter((rule) => rule.productId === productId);
    const productOccurrences = alertOverview.occurrences.filter(
      (occurrence) => occurrence.productId === productId,
    );
    const activeOccurrences = productOccurrences.filter(
      (occurrence) => occurrence.status === "active",
    );
    const productSources = sourceDefinitions
      .filter((source) => source.productId === productId)
      .map((source) => ({
        id: source.id,
        name: source.name,
        sourceType: source.sourceType,
        authoritativeDomain: source.authoritativeDomain,
        status: source.status,
        syncMode: source.syncMode,
        freshnessSeconds: source.freshnessSeconds,
        mappingVersion: source.mappingVersion,
      }));
    const sharedTenantSourceCount = sourceDefinitions.filter(
      (source) => !source.productId,
    ).length;

    const available = productIntelligence.metrics.filter(
      (metric) => metric.status === "available",
    ).length;
    const pendingSemantics = productIntelligence.metrics.filter(
      (metric) => metric.status === "pending_semantics",
    ).length;
    const unavailable = productIntelligence.metrics.length - available - pendingSemantics;

    return {
      product: productIntelligence.product,
      intelligence: productIntelligence,
      commercial,
      finance,
      customer,
      operations,
      health,
      integrations: {
        items: productSources,
        counts: {
          total: productSources.length,
          healthy: productSources.filter((source) => source.status === "healthy").length,
          configured: productSources.filter(
            (source) => source.status === "configured",
          ).length,
          degraded: productSources.filter(
            (source) => source.status === "degraded",
          ).length,
          unavailable: productSources.filter(
            (source) => source.status === "unavailable",
          ).length,
        },
        sharedTenantSourceCount,
        scopeNote:
          "Somente fontes com productId explícito são atribuídas a este produto; fontes globais do tenant não são presumidas como integrações do produto.",
      },
      alerts: {
        rules: productRules,
        occurrences: productOccurrences,
        counts: {
          enabledRules: productRules.filter((rule) => rule.enabled && !rule.archived).length,
          recentActive: activeOccurrences.length,
          recentCriticalActive: activeOccurrences.filter(
            (occurrence) => occurrence.severity === "critical",
          ).length,
          recentAcknowledged: productOccurrences.filter(
            (occurrence) => occurrence.status === "acknowledged",
          ).length,
        },
        windowNote:
          "Ocorrências representam a janela recente governada do Alert Service, não um total histórico.",
      },
      coverage: {
        total: productIntelligence.metrics.length,
        available,
        pendingSemantics,
        unavailable,
      },
    };
  }
}
