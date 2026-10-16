import type { FmccVerticalCognitiveCore } from "@/application/core/fmcc-vertical-cognitive-core";
import type { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import type { CoreAnswer, CoreEvidence, CoreOperationalContext } from "@/domain/core/contracts";
import {
  CoreReadCapabilityContractError,
  type CoreReadCapability,
  type CoreReadCapabilityResult,
} from "@/domain/core/read-capability";
import type { ProductDefinition, ProductRepository } from "@/domain/products/contracts";
import {
  CrossTenantAccessError,
  PermissionDeniedError,
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";
import type { CoreContextReader } from "@/infrastructure/core/audit-core-context-reader";

export class CoreArgumentError extends Error {
  constructor() {
    super("core.argument_invalid");
  }
}

export interface CoreQueryScope {
  readonly productSlugs?: readonly string[];
}

function metricEvidence(
  metricId: string,
  value: MetricView,
  product?: ProductDefinition,
): CoreEvidence {
  return {
    kind: "metric",
    ref: metricId,
    productId: product?.id,
    productSlug: product?.slug,
    sourceAuthority: value.sourceAuthority,
    freshnessStatus: value.freshnessStatus,
    qualityStatus: value.qualityStatus,
    provenanceRefs: value.provenanceRefs,
    periodStart: value.periodStart?.toISOString(),
    periodEnd: value.periodEnd?.toISOString(),
    asOf: value.asOf?.toISOString(),
  };
}

function metricFact(
  metricId: string,
  value: MetricView,
  product?: ProductDefinition,
): Record<string, unknown> {
  return {
    metricId,
    productId: product?.id ?? null,
    productSlug: product?.slug ?? null,
    productName: product?.name ?? null,
    value: value.value,
    unit: value.unit,
    currency: value.currency ?? null,
    periodStart: value.periodStart?.toISOString() ?? null,
    periodEnd: value.periodEnd?.toISOString() ?? null,
    asOf: value.asOf?.toISOString() ?? null,
    computedAt: value.computedAt.toISOString(),
    sourceTimestamp: value.sourceTimestamp?.toISOString() ?? null,
    freshnessStatus: value.freshnessStatus,
    qualityStatus: value.qualityStatus,
    provenanceRefs: value.provenanceRefs,
  };
}

function validateCapabilityResult(
  result: CoreReadCapabilityResult,
): CoreReadCapabilityResult {
  if (
    !result ||
    (result.status !== "available" && result.status !== "unavailable") ||
    !result.evidence ||
    result.evidence.kind !== "source" ||
    typeof result.evidence.ref !== "string" ||
    !result.evidence.ref.trim()
  ) {
    throw new CoreReadCapabilityContractError();
  }
  if (result.status === "available") {
    if (
      !result.fact ||
      typeof result.fact !== "object" ||
      Array.isArray(result.fact) ||
      typeof result.evidence.sourceAuthority !== "string" ||
      !result.evidence.sourceAuthority.trim() ||
      typeof result.evidence.freshnessStatus !== "string" ||
      !result.evidence.freshnessStatus.trim() ||
      typeof result.evidence.qualityStatus !== "string" ||
      !result.evidence.qualityStatus.trim() ||
      !Array.isArray(result.evidence.provenanceRefs) ||
      result.evidence.provenanceRefs.length < 1
    ) {
      throw new CoreReadCapabilityContractError();
    }
  }
  return result;
}

export class CoreGateway {
  constructor(
    private readonly core: FmccVerticalCognitiveCore,
    private readonly metrics: MetricService,
    private readonly contextReader?: CoreContextReader,
    private readonly products?: ProductRepository,
    private readonly financial?: FinancialIntelligenceService,
    private readonly readCapabilities: readonly CoreReadCapability[] = [],
  ) {}

  async ask(
    context: TenantContext,
    question: string,
    scope?: CoreQueryScope,
  ): Promise<CoreAnswer> {
    requirePermission(context, "metric:read");
    const normalized = question.trim();
    if (!normalized || normalized.length > 4000) {
      throw new CoreArgumentError();
    }

    const operationalContext = await this.loadOperationalContext(context);
    const productCatalog = this.products
      ? (await new ProductRegistryService(this.products).list(context)).filter(
          (product) => product.status === "active",
        )
      : [];
    const requestedProductSlugs =
      scope?.productSlugs?.map((slug) => slug.trim()).filter(Boolean) ?? [];
    if (
      requestedProductSlugs.length > 4 ||
      new Set(requestedProductSlugs).size !== requestedProductSlugs.length
    ) {
      throw new CoreArgumentError();
    }

    const bySlug = new Map(
      productCatalog.map((product) => [product.slug, product]),
    );
    const scopedProductCatalog = requestedProductSlugs.length
      ? requestedProductSlugs.map((slug) => bySlug.get(slug))
      : productCatalog;
    if (scopedProductCatalog.some((product) => !product)) {
      throw new CoreArgumentError();
    }

    const plan = await this.core.plan({
      question: normalized,
      operationalContext,
      capabilityCatalog: this.readCapabilities.map(({ descriptor }) => ({
        id: descriptor.id,
        displayName: descriptor.displayName,
        description: descriptor.description,
      })),
      productCatalog: (scopedProductCatalog as ProductDefinition[]).map(
        ({ slug, name }) => ({ slug, name }),
      ),
    });

    if (
      plan.metricIds.length > 8 ||
      plan.capabilityIds.length > 4 ||
      plan.productSlugs.length > 4 ||
      plan.metricIds.length + plan.capabilityIds.length < 1
    ) {
      throw new CoreArgumentError();
    }

    const requestedProductSet = new Set(requestedProductSlugs);
    if (
      requestedProductSlugs.length > 0 &&
      plan.productSlugs.some((slug) => !requestedProductSet.has(slug))
    ) {
      throw new CoreArgumentError();
    }
    const effectiveProductSlugs =
      requestedProductSlugs.length > 0 && plan.productSlugs.length === 0
        ? requestedProductSlugs
        : plan.productSlugs;
    if (
      effectiveProductSlugs.length > 4 ||
      new Set(effectiveProductSlugs).size !== effectiveProductSlugs.length
    ) {
      throw new CoreArgumentError();
    }

    const selectedProducts = effectiveProductSlugs.map((slug) =>
      bySlug.get(slug),
    );
    if (selectedProducts.some((product) => !product)) {
      throw new CoreArgumentError();
    }
    const productScopes = selectedProducts.length
      ? (selectedProducts as ProductDefinition[])
      : [undefined];
    if (productScopes.length * Math.max(plan.metricIds.length, 1) > 16) {
      throw new CoreArgumentError();
    }

    const capabilitiesById = new Map(
      this.readCapabilities.map((capability) => [
        capability.descriptor.id,
        capability,
      ]),
    );
    const selectedCapabilities = plan.capabilityIds.map((id) =>
      capabilitiesById.get(id),
    );
    if (selectedCapabilities.some((capability) => !capability)) {
      throw new CoreArgumentError();
    }

    const selectedProductSlugs = new Set(effectiveProductSlugs);
    for (const capability of selectedCapabilities as CoreReadCapability[]) {
      const supported = capability.descriptor.productSlugs;
      if (
        selectedProductSlugs.size > 0 &&
        supported &&
        supported.length > 0 &&
        !supported.some((slug) => selectedProductSlugs.has(slug))
      ) {
        throw new CoreArgumentError();
      }
    }

    const resolvedMetrics = await Promise.all(
      productScopes.flatMap((product) =>
        plan.metricIds.map(async (metricId) => {
          try {
            if (metricId === "finance.operating_result" && this.financial) {
              const finance = await this.financial.overview(
                context,
                product?.id,
              );
              if (finance.operatingResult.status !== "available") {
                return { metricId, product, value: null };
              }
              const derived: MetricView = {
                productId: product?.id,
                metricId,
                metricVersion: 1,
                value: finance.operatingResult.value,
                unit: "currency",
                currency: finance.operatingResult.currency,
                periodStart: finance.operatingResult.periodStart,
                periodEnd: finance.operatingResult.periodEnd,
                asOf: finance.operatingResult.asOf,
                computedAt: new Date(),
                sourceTimestamp: finance.operatingResult.sourceTimestamp,
                freshnessStatus: "unknown",
                qualityStatus: "unknown",
                sourceAuthority: "fmcc_financial_intelligence",
                provenanceRefs: finance.operatingResult.provenanceRefs,
              };
              return { metricId, product, value: derived };
            }
            return {
              metricId,
              product,
              value: await this.metrics.query(context, metricId, product?.id),
            };
          } catch {
            throw new CoreArgumentError();
          }
        }),
      ),
    );

    const resolvedCapabilities = await Promise.all(
      (selectedCapabilities as CoreReadCapability[]).map(async (capability) => {
        try {
          const result = await capability.read(context, {
            productSlugs: effectiveProductSlugs,
          });
          return {
            capabilityId: capability.descriptor.id,
            result: validateCapabilityResult(result),
          };
        } catch (error) {
          if (
            error instanceof PermissionDeniedError ||
            error instanceof CrossTenantAccessError ||
            error instanceof CoreReadCapabilityContractError
          ) {
            throw error;
          }
          throw new CoreReadCapabilityContractError();
        }
      }),
    );

    const availableMetrics = resolvedMetrics.filter(
      (entry) => entry.value !== null && entry.value.value !== null,
    ) as Array<{
      metricId: string;
      product: ProductDefinition | undefined;
      value: MetricView;
    }>;
    const availableCapabilities = resolvedCapabilities.filter(
      (
        entry,
      ): entry is {
        capabilityId: string;
        result: Extract<CoreReadCapabilityResult, { status: "available" }>;
      } => entry.result.status === "available",
    );

    if (
      availableMetrics.length === 0 &&
      availableCapabilities.length === 0
    ) {
      return {
        answer:
          "Os dados solicitados estão indisponíveis porque ainda não existem valores governados ou uma fonte autorizada disponível para esta consulta.",
        evidence: [
          ...resolvedMetrics.map(({ metricId, product }) => ({
            kind: "metric" as const,
            ref: metricId,
            productId: product?.id,
            productSlug: product?.slug,
          })),
          ...resolvedCapabilities.map(({ result }) => result.evidence),
        ],
        factualStatus: "unavailable",
      };
    }

    const evidence = [
      ...availableMetrics.map(({ metricId, product, value }) =>
        metricEvidence(metricId, value, product),
      ),
      ...availableCapabilities.map(({ result }) => result.evidence),
    ];
    const facts = [
      ...availableMetrics.map(({ metricId, product, value }) =>
        metricFact(metricId, value, product),
      ),
      ...availableCapabilities.map(({ result }) => result.fact),
    ];

    return this.core.synthesize({
      question: normalized,
      facts,
      evidence,
      operationalContext,
    });
  }

  private async loadOperationalContext(
    context: TenantContext,
  ): Promise<readonly CoreOperationalContext[]> {
    if (!this.contextReader) return [];
    try {
      return await this.contextReader.recent({
        tenantId: context.tenantId,
        userId: context.userId,
        limit: 6,
      });
    } catch {
      return [];
    }
  }
}
