import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapKordenaCommercialRuntime } from "@/application/integration/kordena-runtime-bootstrap";
import { kordenaRuntimeBootstrapConfig } from "@/config/kordena-runtime-bootstrap";
import type { SourceDefinition } from "@/domain/integration/contracts";

const ENV_KEYS = [
  "FMCC_KORDENA_RUNTIME_BOOTSTRAP",
  "FMCC_KORDENA_RUNTIME_BOOTSTRAP_VERIFY",
  "FMCC_KORDENA_CONTROL_TENANT_ID",
  "FMCC_KORDENA_ALLOWED_ORIGINS",
  "FMCC_KORDENA_BASE_URL",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.restoreAllMocks();
});

function configure() {
  process.env.FMCC_KORDENA_RUNTIME_BOOTSTRAP = "true";
  process.env.FMCC_KORDENA_RUNTIME_BOOTSTRAP_VERIFY = "true";
  process.env.FMCC_KORDENA_CONTROL_TENANT_ID = "tenant-nova-fm";
  process.env.FMCC_KORDENA_ALLOWED_ORIGINS = "https://kordena.example.test";
  process.env.FMCC_KORDENA_BASE_URL = "https://kordena.example.test/";
}

function source(): SourceDefinition {
  return {
    id: "source-kordena",
    tenantId: "tenant-nova-fm",
    productId: "product-kordena",
    name: "Kordena Commercial",
    sourceType: "kordena-commercial-v1",
    authoritativeDomain: "commercial",
    status: "configured",
    syncMode: "pull",
    secretRef: "env:FMCC_KORDENA_CONTROL_PLANE_TOKEN",
    config: { baseUrl: "https://kordena.example.test" },
    freshnessSeconds: 300,
    mappingVersion: "kordena-commercial-v1",
  };
}

describe("KF-03 Kordena runtime bootstrap", () => {
  it("is disabled by default", () => {
    expect(kordenaRuntimeBootstrapConfig()).toBeNull();
  });

  it("fails closed when the configured base URL is outside the allowlist", () => {
    process.env.FMCC_KORDENA_RUNTIME_BOOTSTRAP = "true";
    process.env.FMCC_KORDENA_CONTROL_TENANT_ID = "tenant-nova-fm";
    process.env.FMCC_KORDENA_ALLOWED_ORIGINS = "https://allowed.example.test";
    process.env.FMCC_KORDENA_BASE_URL = "https://other.example.test";
    expect(() => kordenaRuntimeBootstrapConfig()).toThrow(
      "config.FMCC_KORDENA_BASE_URL_not_allowlisted",
    );
  });

  it("reuses an exact existing source and verifies health/sync", async () => {
    configure();
    const existing = source();
    const sources = {
      list: vi.fn().mockResolvedValue([existing]),
      findById: vi.fn(),
      create: vi.fn(),
    };
    const products = {
      findBySlug: vi.fn().mockResolvedValue({
        id: "product-kordena",
        tenantId: "tenant-nova-fm",
        slug: "kordena",
        name: "Kordena",
        status: "active",
      }),
    };
    const runtime = {
      health: vi.fn().mockResolvedValue("healthy"),
      syncPull: vi.fn().mockResolvedValue({
        status: "completed",
        executionId: "sync-1",
        ingested: 12,
      }),
    };

    const result = await bootstrapKordenaCommercialRuntime({
      sources: sources as never,
      products: products as never,
      runtime: runtime as never,
    });

    expect(result).toMatchObject({
      status: "ready",
      sourceId: "source-kordena",
      created: false,
      health: "healthy",
      sync: "completed",
      ingested: 12,
    });
    const firstSyncInput = runtime.syncPull.mock.calls[0][1];
    expect(firstSyncInput.idempotencyKey).toMatch(
      /^kf03-kordena-runtime-bootstrap-v2:kf03-bootstrap-[0-9a-f-]{36}$/,
    );

    await bootstrapKordenaCommercialRuntime({
      sources: sources as never,
      products: products as never,
      runtime: runtime as never,
    });
    const secondSyncInput = runtime.syncPull.mock.calls[1][1];
    expect(secondSyncInput.idempotencyKey).not.toBe(
      firstSyncInput.idempotencyKey,
    );
    expect(sources.create).not.toHaveBeenCalled();
  });

  it("fails closed instead of rewriting a mismatched source", async () => {
    configure();
    const mismatched = {
      ...source(),
      config: { baseUrl: "https://wrong.example.test" },
    };
    const sources = {
      list: vi.fn().mockResolvedValue([mismatched]),
      findById: vi.fn(),
      create: vi.fn(),
    };
    const products = {
      findBySlug: vi.fn().mockResolvedValue({
        id: "product-kordena",
        tenantId: "tenant-nova-fm",
        slug: "kordena",
        name: "Kordena",
        status: "active",
      }),
    };

    await expect(
      bootstrapKordenaCommercialRuntime({
        sources: sources as never,
        products: products as never,
      }),
    ).rejects.toThrow("integration.kordena_bootstrap_source_mismatch");
    expect(sources.create).not.toHaveBeenCalled();
  });
});
