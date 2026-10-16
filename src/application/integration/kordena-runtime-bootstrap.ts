import { randomUUID } from "node:crypto";
import { buildConnectorRuntime } from "@/application/integration/connector-composition";
import { SourceRegistryService } from "@/application/integration/source-registry-service";
import { kordenaRuntimeBootstrapConfig } from "@/config/kordena-runtime-bootstrap";
import type { SourceDefinition } from "@/domain/integration/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";
import {
  KORDENA_COMMERCIAL_SECRET_REF,
  KORDENA_COMMERCIAL_SOURCE_TYPE,
} from "@/infrastructure/integration/kordena-commercial-connector";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { logEvent } from "@/infrastructure/observability/logger";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

const SOURCE_NAME = "Kordena Commercial";
const PRODUCT_SLUG = "kordena";
const AUTHORITATIVE_DOMAIN = "commercial";
const MAPPING_VERSION = "kordena-commercial-v1";
const FRESHNESS_SECONDS = 300;
const BOOTSTRAP_IDEMPOTENCY_PREFIX = "kf03-kordena-runtime-bootstrap-v2";

type BootstrapDependencies = {
  readonly sources?: PostgresSourceRepository;
  readonly products?: PostgresProductRepository;
  readonly runtime?: ReturnType<typeof buildConnectorRuntime>;
};

function systemContext(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: "system:kordena-runtime-bootstrap",
    role: "owner",
    correlationId: `kf03-bootstrap-${randomUUID()}`,
  };
}

function assertExistingSource(
  source: SourceDefinition,
  expected: {
    tenantId: string;
    productId: string;
    baseUrl: string;
  },
): void {
  const baseUrl =
    typeof source.config.baseUrl === "string" ? source.config.baseUrl : "";
  if (
    source.tenantId !== expected.tenantId ||
    source.productId !== expected.productId ||
    source.name !== SOURCE_NAME ||
    source.sourceType !== KORDENA_COMMERCIAL_SOURCE_TYPE ||
    source.authoritativeDomain !== AUTHORITATIVE_DOMAIN ||
    source.syncMode !== "pull" ||
    source.secretRef !== KORDENA_COMMERCIAL_SECRET_REF ||
    source.mappingVersion !== MAPPING_VERSION ||
    baseUrl.replace(/\/$/, "") !== expected.baseUrl
  ) {
    throw new Error("integration.kordena_bootstrap_source_mismatch");
  }
}

export async function bootstrapKordenaCommercialRuntime(
  dependencies: BootstrapDependencies = {},
): Promise<
  | { status: "disabled" }
  | {
      status: "ready";
      sourceId: string;
      created: boolean;
      health?: "healthy";
      sync?: "completed" | "duplicate" | "in_progress";
      ingested?: number;
    }
> {
  const config = kordenaRuntimeBootstrapConfig();
  if (!config) return { status: "disabled" };

  const sources = dependencies.sources ?? new PostgresSourceRepository();
  const products = dependencies.products ?? new PostgresProductRepository();
  const context = systemContext(config.tenantId);

  const product = await products.findBySlug(config.tenantId, PRODUCT_SLUG);
  if (!product || product.status !== "active") {
    throw new Error("integration.kordena_bootstrap_product_missing");
  }

  const candidates = (await sources.list(config.tenantId)).filter(
    (source) =>
      source.name === SOURCE_NAME ||
      source.sourceType === KORDENA_COMMERCIAL_SOURCE_TYPE,
  );
  if (candidates.length > 1) {
    throw new Error("integration.kordena_bootstrap_source_ambiguous");
  }

  let source = candidates[0];
  let created = false;
  if (source) {
    assertExistingSource(source, {
      tenantId: config.tenantId,
      productId: product.id,
      baseUrl: config.baseUrl,
    });
  } else {
    source = await new SourceRegistryService(sources, products).register(context, {
      productId: product.id,
      name: SOURCE_NAME,
      sourceType: KORDENA_COMMERCIAL_SOURCE_TYPE,
      authoritativeDomain: AUTHORITATIVE_DOMAIN,
      syncMode: "pull",
      secretRef: KORDENA_COMMERCIAL_SECRET_REF,
      mappingVersion: MAPPING_VERSION,
      freshnessSeconds: FRESHNESS_SECONDS,
      config: { baseUrl: config.baseUrl },
    });
    created = true;
    logEvent("info", "kordena_runtime_source_bootstrapped", {
      tenantId: config.tenantId,
      sourceId: source.id,
      productId: product.id,
    });
  }

  if (!config.verifyOnStartup) {
    return { status: "ready", sourceId: source.id, created };
  }

  const runtime = dependencies.runtime ?? buildConnectorRuntime();
  const health = await runtime.health(context, source.id);
  if (health !== "healthy") {
    throw new Error("integration.kordena_bootstrap_health_failed");
  }

  const sync = await runtime.syncPull(context, {
    sourceId: source.id,
    idempotencyKey: `${BOOTSTRAP_IDEMPOTENCY_PREFIX}:${context.correlationId}`,
  });
  if (sync.status !== "completed" && sync.status !== "duplicate" && sync.status !== "in_progress") {
    throw new Error("integration.kordena_bootstrap_sync_failed");
  }
  logEvent("info", "kordena_runtime_bootstrap_verified", {
    tenantId: config.tenantId,
    sourceId: source.id,
    syncStatus: sync.status,
    ingested: sync.ingested,
  });

  return {
    status: "ready",
    sourceId: source.id,
    created,
    health: "healthy",
    sync: sync.status,
    ingested: sync.ingested,
  };
}
