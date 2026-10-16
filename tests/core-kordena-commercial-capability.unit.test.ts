import { describe, expect, it, vi } from "vitest";
import { KordenaCommercialSummaryCapability } from "@/application/core/kordena-commercial-summary-capability";
import type { KordenaCommercialControlService } from "@/application/integration/kordena-commercial-control-service";
import type { SourceDefinition, SourceRepository } from "@/domain/integration/contracts";
import type { ProductDefinition, ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";
import type { KordenaCommercialSnapshot } from "@/infrastructure/integration/kordena-commercial-connector";

const context: TenantContext = {
  tenantId: "tenant-fmcc",
  userId: "director",
  role: "owner",
  correlationId: "corr-core-kordena",
};

const product: ProductDefinition = {
  id: "product-kordena",
  tenantId: "tenant-fmcc",
  slug: "kordena",
  name: "Kordena",
  status: "active",
};

const source: SourceDefinition = {
  id: "source-kordena",
  tenantId: "tenant-fmcc",
  productId: product.id,
  name: "Kordena Commercial",
  sourceType: "kordena-commercial-v1",
  authoritativeDomain: "commercial",
  status: "healthy",
  syncMode: "pull",
  secretRef: "env:FMCC_KORDENA_CONTROL_PLANE_TOKEN",
  config: {
    baseUrl: "https://kordena.example.test",
    privateHint: "must-not-reach-core",
  },
  freshnessSeconds: 300,
  mappingVersion: "kordena-commercial-v1",
};

function products(row: ProductDefinition | null = product): ProductRepository {
  return {
    async findById(tenantId, productId) {
      return row?.tenantId === tenantId && row.id === productId ? row : null;
    },
    async findBySlug(tenantId, slug) {
      return row?.tenantId === tenantId && row.slug === slug ? row : null;
    },
    async list(tenantId) {
      return row?.tenantId === tenantId ? [row] : [];
    },
    async create() {
      throw new Error("unused");
    },
  };
}

function sources(rows: readonly SourceDefinition[] = [source]): SourceRepository {
  return {
    async findById(tenantId, sourceId) {
      return rows.find(
        (item) => item.tenantId === tenantId && item.id === sourceId,
      ) ?? null;
    },
    async list() {
      return rows;
    },
    async create() {
      throw new Error("unused");
    },
  };
}

function snapshot(
  asOf = "2026-09-23T18:00:00.000Z",
): KordenaCommercialSnapshot {
  return {
    schema_version: "kordena.fmcc.commercial.v1",
    product_code: "KORDENA",
    as_of: asOf,
    customers: [],
    product_accounts: [],
    trials: [],
    subscriptions: [],
    billing_transactions: [],
    entitlements: [],
    catalog: [],
    summary: {
      customers: 12,
      internal_test_customers: 1,
      active_trials: 3,
      active_subscriptions: 7,
      past_due_subscriptions: 2,
      suspended_subscriptions: 1,
      confirmed_payments: 8,
      failed_payments: 1,
      reconciled_transactions: 9,
      users: 20,
      units: 14,
    },
    facts: [],
    coverage: {
      mrr: "pending_governed_semantics",
      arr: "pending_governed_semantics",
      churn: "pending_governed_semantics",
    },
  };
}

function control(
  read: () => Promise<KordenaCommercialSnapshot>,
): KordenaCommercialControlService {
  return {
    snapshot: vi.fn(read),
  } as unknown as KordenaCommercialControlService;
}

describe("FMCC cognitive Kordena commercial read capability", () => {
  it("returns only governed summary data with source provenance", async () => {
    const capability = new KordenaCommercialSummaryCapability(
      sources(),
      products(),
      control(async () => snapshot()),
      () => new Date("2026-09-23T18:01:00.000Z"),
    );

    const result = await capability.read(context, {
      productSlugs: ["kordena"],
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("expected available");
    expect(result.fact).toMatchObject({
      capabilityId: "commercial.kordena.summary",
      productSlug: "kordena",
      summary: {
        active_trials: 3,
        active_subscriptions: 7,
        past_due_subscriptions: 2,
        confirmed_payments: 8,
      },
    });
    expect(result.evidence).toMatchObject({
      kind: "source",
      ref: "kordena.fmcc.commercial.v1",
      sourceAuthority: "kordena_fm_commercial_platform",
      freshnessStatus: "fresh",
      qualityStatus: "verified",
      asOf: "2026-09-23T18:00:00.000Z",
      provenanceRefs: [
        "source:source-kordena",
        "mapping:kordena-commercial-v1",
        "schema:kordena.fmcc.commercial.v1",
      ],
    });
    expect(result.fact).toMatchObject({
      schemaVersion: "kordena.fmcc.commercial.v1",
      mappingVersion: "kordena-commercial-v1",
    });
    expect(JSON.stringify(result)).not.toContain(
      "FMCC_KORDENA_CONTROL_PLANE_TOKEN",
    );
    expect(JSON.stringify(result)).not.toContain("privateHint");
    expect(JSON.stringify(result)).not.toContain("kordena.example.test");
  });

  it("fails closed when the only source row belongs to another tenant", async () => {
    const foreign = { ...source, tenantId: "tenant-foreign" };
    const read = vi.fn(async () => snapshot());
    const capability = new KordenaCommercialSummaryCapability(
      sources([foreign]),
      products(),
      control(read),
      () => new Date("2026-09-23T18:01:00.000Z"),
    );

    const result = await capability.read(context, {
      productSlugs: ["kordena"],
    });

    expect(result.status).toBe("unavailable");
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects stale commercial context instead of presenting it as current", async () => {
    const capability = new KordenaCommercialSummaryCapability(
      sources(),
      products(),
      control(async () => snapshot("2026-09-23T17:00:00.000Z")),
      () => new Date("2026-09-23T18:01:00.000Z"),
    );

    const result = await capability.read(context, {
      productSlugs: ["kordena"],
    });

    expect(result.status).toBe("unavailable");
    expect(result.evidence.freshnessStatus).toBe("stale");
  });

  it("aplica freshness fail-closed padrão quando a source não declara política", async () => {
    const withoutFreshness = { ...source, freshnessSeconds: undefined };
    const capability = new KordenaCommercialSummaryCapability(
      sources([withoutFreshness]),
      products(),
      control(async () => snapshot("2026-09-23T17:50:00.000Z")),
      () => new Date("2026-09-23T18:01:00.000Z"),
    );

    const result = await capability.read(context, {
      productSlugs: ["kordena"],
    });

    expect(result.status).toBe("unavailable");
    expect(result.evidence.freshnessStatus).toBe("stale");
  });

  it("converts source failure into unavailable evidence without inventing data", async () => {
    const capability = new KordenaCommercialSummaryCapability(
      sources(),
      products(),
      control(async () => {
        throw new Error("upstream timeout with private details");
      }),
      () => new Date("2026-09-23T18:01:00.000Z"),
    );

    const result = await capability.read(context, {
      productSlugs: ["kordena"],
    });

    expect(result).toMatchObject({
      status: "unavailable",
      evidence: {
        ref: "kordena.fmcc.commercial.v1",
        freshnessStatus: "unavailable",
        qualityStatus: "missing",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private details");
  });

  it("não trata resumo Kordena como total global sem produto explícito", async () => {
    const read = vi.fn(async () => snapshot());
    const capability = new KordenaCommercialSummaryCapability(
      sources(),
      products(),
      control(read),
    );

    const result = await capability.read(context, {
      productSlugs: [],
    });

    expect(result.status).toBe("unavailable");
    expect(read).not.toHaveBeenCalled();
  });

  it("does not use Kordena state for a different selected product", async () => {
    const read = vi.fn(async () => snapshot());
    const capability = new KordenaCommercialSummaryCapability(
      sources(),
      products(),
      control(read),
    );

    const result = await capability.read(context, {
      productSlugs: ["iron"],
    });

    expect(result.status).toBe("unavailable");
    expect(read).not.toHaveBeenCalled();
  });
});
