import type { KordenaCommercialControlService } from "@/application/integration/kordena-commercial-control-service";
import type { ProductRepository } from "@/domain/products/contracts";
import type { SourceRepository } from "@/domain/integration/contracts";
import type {
  CoreReadCapability,
  CoreReadCapabilityResult,
} from "@/domain/core/read-capability";
import {
  CrossTenantAccessError,
  PermissionDeniedError,
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";
import { KORDENA_COMMERCIAL_SOURCE_TYPE } from "@/infrastructure/integration/kordena-commercial-connector";

const CONTRACT_REF = "kordena.fmcc.commercial.v1";
const CAPABILITY_ID = "commercial.kordena.summary";

function unavailableEvidence(productId?: string) {
  return {
    kind: "source" as const,
    ref: CONTRACT_REF,
    productId,
    productSlug: "kordena",
    sourceAuthority: "kordena_fm_commercial_platform",
    freshnessStatus: "unavailable",
    qualityStatus: "missing",
  };
}

export class KordenaCommercialSummaryCapability implements CoreReadCapability {
  readonly descriptor = {
    id: CAPABILITY_ID,
    displayName: "Resumo comercial atual do Kordena",
    description:
      "Estado atual governado de clientes, trials, assinaturas, past due, pagamentos, usuários e unidades do Kordena, incluindo cobertura explícita de métricas comerciais ainda indisponíveis.",
    productSlugs: ["kordena"],
  } as const;

  constructor(
    private readonly sources: SourceRepository,
    private readonly products: ProductRepository,
    private readonly control: KordenaCommercialControlService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(
    context: TenantContext,
    input: { readonly productSlugs: readonly string[] },
  ): Promise<CoreReadCapabilityResult> {
    requirePermission(context, "commercial:read");

    if (
      input.productSlugs.length === 0 ||
      !input.productSlugs.includes("kordena")
    ) {
      return { status: "unavailable", evidence: unavailableEvidence() };
    }

    const product = await this.products.findBySlug(context.tenantId, "kordena");
    if (
      !product ||
      product.tenantId !== context.tenantId ||
      product.status !== "active"
    ) {
      return { status: "unavailable", evidence: unavailableEvidence() };
    }

    const candidates = (await this.sources.list(context.tenantId)).filter(
      (source) =>
        source.tenantId === context.tenantId &&
        source.productId === product.id &&
        source.sourceType === KORDENA_COMMERCIAL_SOURCE_TYPE,
    );
    if (candidates.length !== 1) {
      return {
        status: "unavailable",
        evidence: unavailableEvidence(product.id),
      };
    }

    const source = candidates[0];
    try {
      const snapshot = await this.control.snapshot(context, source.id);
      const asOf = new Date(snapshot.as_of);
      const current = this.now();
      const maxAgeMs = (source.freshnessSeconds ?? 300) * 1000;
      const ageMs = current.getTime() - asOf.getTime();
      const stale =
        Number.isNaN(asOf.getTime()) ||
        ageMs < -60_000 ||
        ageMs > maxAgeMs;

      const evidence = {
        kind: "source" as const,
        ref: CONTRACT_REF,
        productId: product.id,
        productSlug: product.slug,
        sourceAuthority: "kordena_fm_commercial_platform",
        freshnessStatus: stale ? "stale" : "fresh",
        qualityStatus: stale ? "partial" : "verified",
        provenanceRefs: [
          `source:${source.id}`,
          `mapping:${source.mappingVersion}`,
          `schema:${snapshot.schema_version}`,
        ],
        asOf: snapshot.as_of,
      };

      if (stale) return { status: "unavailable", evidence };

      return {
        status: "available",
        fact: {
          capabilityId: CAPABILITY_ID,
          productId: product.id,
          productSlug: product.slug,
          productName: product.name,
          asOf: snapshot.as_of,
          schemaVersion: snapshot.schema_version,
          mappingVersion: source.mappingVersion,
          summary: snapshot.summary,
          observability: snapshot.observability,
          coverage: snapshot.coverage,
        },
        evidence,
      };
    } catch (error) {
      if (
        error instanceof CrossTenantAccessError ||
        error instanceof PermissionDeniedError
      ) {
        throw error;
      }
      return {
        status: "unavailable",
        evidence: unavailableEvidence(product.id),
      };
    }
  }
}
