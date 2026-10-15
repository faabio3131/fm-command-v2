import { describe, expect, it } from "vitest";
import { loadTenantIntegrationFeatures } from "@/application/integration/tenant-integration-features";
import type {
  SourceDefinition,
  SourceRepository,
} from "@/domain/integration/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

class FakeSources implements SourceRepository {
  constructor(private readonly sources: readonly SourceDefinition[]) {}

  async findById(tenantId: string, sourceId: string) {
    return (
      this.sources.find(
        (source) => source.tenantId === tenantId && source.id === sourceId,
      ) ?? null
    );
  }

  async list(tenantId: string) {
    return this.sources.filter((source) => source.tenantId === tenantId);
  }

  async create(): Promise<SourceDefinition> {
    throw new Error("not_used");
  }
}

function context(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: "user-test",
    role: "owner",
    correlationId: "corr-test",
  };
}

const kordenaSource: SourceDefinition = {
  id: "source-kordena",
  tenantId: "tenant-fm",
  productId: "product-kordena",
  name: "Kordena Commercial",
  sourceType: "kordena-commercial-v1",
  authoritativeDomain: "commercial",
  status: "healthy",
  syncMode: "pull",
  secretRef: "env:FMCC_KORDENA_CONTROL_PLANE_TOKEN",
  mappingVersion: "kordena-commercial-v1",
  config: { baseUrl: "https://kordena.example.test" },
};

describe("tenant integration features", () => {
  it("habilita Kordena somente no tenant que possui a source", async () => {
    const sources = new FakeSources([kordenaSource]);

    await expect(
      loadTenantIntegrationFeatures(context("tenant-fm"), sources),
    ).resolves.toEqual({ kordenaCommercial: true });

    await expect(
      loadTenantIntegrationFeatures(context("tenant-cliente"), sources),
    ).resolves.toEqual({ kordenaCommercial: false });
  });

  it("não habilita Kordena por nome de produto sem source configurada", async () => {
    const sources = new FakeSources([]);

    await expect(
      loadTenantIntegrationFeatures(context("tenant-fm"), sources),
    ).resolves.toEqual({ kordenaCommercial: false });
  });
});
