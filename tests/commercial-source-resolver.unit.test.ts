import { describe, expect, it } from "vitest";
import { CommercialSourceResolver } from "@/application/integration/commercial-source-resolver";
import { SourceRegistryService } from "@/application/integration/source-registry-service";
import type { SourceDefinition, SourceRepository } from "@/domain/integration/contracts";
import type { FmccRole } from "@/domain/security/permissions";
import type { TenantContext } from "@/domain/security/tenant-context";

const kordena: SourceDefinition = {
  id: "source-kordena",
  tenantId: "tenant-a",
  productId: "product-kordena",
  name: "Kordena Comercial",
  sourceType: "kordena-commercial-v1",
  authoritativeDomain: "kordena-commercial",
  status: "healthy",
  syncMode: "pull",
  secretRef: "render:kordena-commercial-api",
  config: { baseUrl: "https://kordena.example.test" },
  freshnessSeconds: 300,
  mappingVersion: "kordena-commercial-v1",
};

function repo(): SourceRepository {
  return {
    async findById(tenantId, sourceId) {
      return tenantId === kordena.tenantId && sourceId === kordena.id ? kordena : null;
    },
    async list(tenantId) {
      return tenantId === "tenant-a"
        ? [kordena, { ...kordena, id: "foreign", tenantId: "tenant-b" }]
        : [];
    },
    async create() {
      throw new Error("unused");
    },
  };
}

function context(role: FmccRole, tenantId = "tenant-a"): TenantContext {
  return { tenantId, userId: `user-${role}`, role, correlationId: `corr-${role}` };
}

describe("commercial source resolver", () => {
  for (const role of ["owner", "admin", "analyst", "viewer", "member"] as const) {
    it(`permite lookup Kordena para ${role} com commercial:read`, async () => {
      const result = await new CommercialSourceResolver(repo()).findByType(
        context(role),
        "kordena-commercial-v1",
      );
      expect(result?.id).toBe("source-kordena");
      expect(result?.tenantId).toBe("tenant-a");
    });
  }

  it("nao encontra fonte de outro tenant", async () => {
    const result = await new CommercialSourceResolver(repo()).findByType(
      context("viewer", "tenant-b"),
      "kordena-commercial-v1",
    );
    expect(result).toBeNull();
  });

  it("viewer/member continuam sem acesso a listagem administrativa de fontes", async () => {
    await expect(new SourceRegistryService(repo()).list(context("viewer")))
      .rejects.toThrow("security.permission_denied:source:read");
    await expect(new SourceRegistryService(repo()).list(context("member")))
      .rejects.toThrow("security.permission_denied:source:read");
  });
});
