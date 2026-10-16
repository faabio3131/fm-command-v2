import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { computeExecutiveVariation } from "@/domain/executive/analysis";
import { getMetricDefinition } from "@/domain/metrics/registry";
import type { ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

export const EXECUTIVE_ANALYSIS_METRICS = [
  "billing.gross_billed",
  "revenue.cash_collected",
  "lead.created.count",
  "incident.count",
  "service.error.count",
  "usage.active_users.dau",
  "support.ticket.open.count",
] as const;

export class ExecutiveAnalysisArgumentError extends Error {
  constructor() { super("executive.analysis_argument_invalid"); }
}

export class ExecutiveAnalysisService {
  private readonly products?: ProductRegistryService;

  constructor(
    private readonly metrics: MetricService,
    products?: ProductRepository,
  ) {
    this.products = products ? new ProductRegistryService(products) : undefined;
  }

  async overview(
    context: TenantContext,
    input: { productId?: string; metricIds?: readonly string[] } = {},
  ) {
    const product = input.productId && this.products ? await this.products.get(context, input.productId) : null;
    const metricIds = [...new Set(input.metricIds?.length ? input.metricIds : EXECUTIVE_ANALYSIS_METRICS)];
    if (metricIds.length < 1 || metricIds.length > 8 || metricIds.some((metricId) => !getMetricDefinition(metricId))) {
      throw new ExecutiveAnalysisArgumentError();
    }

    const signals = await Promise.all(metricIds.map(async (metricId) => {
      const value = await this.metrics.query(context, metricId, product?.id);
      let history: readonly MetricView[] = [];
      if (product) history = await this.metrics.history(context, metricId, product.id, 2);
      const variation = computeExecutiveVariation(history);
      return {
        metricId,
        displayName: getMetricDefinition(metricId)?.displayName ?? metricId,
        epistemicKind: value?.value !== null && value ? "fact" as const : "unavailable" as const,
        status: value?.value !== null && value ? "available" as const : "unavailable" as const,
        value,
        variation,
        provenanceRefs: value?.provenanceRefs ?? [],
      };
    }));

    const availableSignals = signals.filter((signal) => signal.status === "available");
    return {
      scope: {
        tenantId: context.tenantId,
        productId: product?.id ?? null,
        productSlug: product?.slug ?? null,
      },
      signals,
      correlation: {
        status: availableSignals.length >= 2 ? "evidence_ready" as const : "insufficient_evidence" as const,
        note: availableSignals.length >= 2
          ? "Há múltiplos fatos governados disponíveis para correlação cognitiva; correlação não implica causalidade."
          : "Correlação exige pelo menos dois fatos governados disponíveis.",
      },
      anomaly: {
        status: "insufficient_evidence" as const,
        reason: "Anomalia exige baseline, janela temporal e threshold aprovados.",
      },
      risk: {
        status: "insufficient_evidence" as const,
        reason: "Classificação de risco exige política/threshold explicável aprovado.",
      },
      forecast: {
        status: "insufficient_evidence" as const,
        reason: "Previsão exige série temporal suficiente, método documentado, horizonte e incerteza.",
      },
      recommendation: {
        status: availableSignals.length ? "evidence_ready" as const : "insufficient_evidence" as const,
        note: "Recomendações são cognitivas e nunca executam ações críticas diretamente.",
      },
    };
  }
}
