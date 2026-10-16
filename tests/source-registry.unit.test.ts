import { describe, expect, it } from "vitest";
import { SourceRegistryService } from "@/application/integration/source-registry-service";
import type { SourceRepository } from "@/domain/integration/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

function repo(): SourceRepository {
  return {
    async findById() { return null; },
    async list() { return []; },
    async create(tenantId, input) {
      return { id: "s1", tenantId, productId: input.productId, name: input.name, sourceType: input.sourceType, authoritativeDomain: input.authoritativeDomain, status: "configured" as const, syncMode: input.syncMode, secretRef: input.secretRef, config: input.config ?? {}, freshnessSeconds: input.freshnessSeconds, mappingVersion: input.mappingVersion ?? "v1" };
    },
  };
}
const owner: TenantContext = { tenantId: "t1", userId: "u1", role: "owner", correlationId: "c1" };

describe("F07 Source Registry", () => {
  it("aceita secret reference e nunca exige secret bruto", async () => {
    const source = await new SourceRegistryService(repo()).register(owner, {
      name: "Billing", sourceType: "billing-fixture", authoritativeDomain: "billing", syncMode: "pull", secretRef: "render:billing-api",
    });
    expect(source.secretRef).toBe("render:billing-api");
  });

  it("rejeita valor bruto no campo secretRef", async () => {
    await expect(new SourceRegistryService(repo()).register(owner, {
      name: "Billing", sourceType: "billing-fixture", authoritativeDomain: "billing", syncMode: "pull", secretRef: "super-secret-value",
    })).rejects.toThrow("integration.secret_reference_invalid");
  });

  it("rejeita segredo bruto escondido no config", async () => {
    await expect(new SourceRegistryService(repo()).register(owner, {
      name: "Billing", sourceType: "billing-fixture", authoritativeDomain: "billing", syncMode: "pull",
      secretRef: "render:billing-api",
      config: { endpoint: "https://example.test", nested: { apiKey: "should-not-be-persisted" } },
    })).rejects.toThrow("integration.config_secret_forbidden");
  });

  it("valida product scope dentro do tenant antes de registrar source", async () => {
    const products = {
      async findById(tenantId: string, productId: string) {
        return tenantId === "t1" && productId === "p1" ? { id: "p1", tenantId: "t1", slug: "kordena", name: "Kordena", status: "active" as const } : null;
      },
      async findBySlug() { return null; },
      async list() { return []; },
      async create() { throw new Error("unused"); },
    };
    const source = await new SourceRegistryService(repo(), products).register(owner, {
      productId: "p1", name: "Billing", sourceType: "billing-fixture", authoritativeDomain: "billing", syncMode: "pull",
    });
    expect(source.productId).toBe("p1");
    await expect(new SourceRegistryService(repo(), products).register(owner, {
      productId: "foreign", name: "Foreign", sourceType: "billing-fixture", authoritativeDomain: "billing", syncMode: "pull",
    })).rejects.toThrow("integration.product_scope_invalid");
  });

  it("aplica RBAC server-side", async () => {
    const viewer: TenantContext = { ...owner, role: "viewer" };
    await expect(new SourceRegistryService(repo()).register(viewer, {
      name: "Billing", sourceType: "billing-fixture", authoritativeDomain: "billing", syncMode: "pull",
    })).rejects.toThrow("security.permission_denied:source:write");
  });
  it("rejeita troca de credencial, tipo e produto entre IRON e Kordena", async () => {
    const products = {
      async findById(tenantId: string, productId: string) {
        if (tenantId !== "t1") return null;
        const slug = productId === "iron-id" ? "iron" : productId === "kordena-id" ? "kordena" : null;
        return slug ? { id: productId, tenantId, slug, name: slug, status: "active" as const } : null;
      },
      async findBySlug() { return null; },
      async list() { return []; },
      async create() { throw new Error("unused"); },
    };
    let creates = 0;
    const repository = { ...repo(), async create(tenantId: string, input: Parameters<SourceRepository["create"]>[1]) {
      creates += 1;
      return repo().create(tenantId, input);
    } };
    const service = new SourceRegistryService(repository, products);
    const valid = {
      productId: "iron-id",
      name: "IRON FIT CORE Commercial",
      sourceType: "iron-commercial-v1",
      authoritativeDomain: "commercial",
      syncMode: "pull" as const,
      mappingVersion: "iron-commercial-v1",
      secretRef: "env:FMCC_IRON_CONTROL_PLANE_TOKEN",
    };
    await expect(service.register(owner, valid)).resolves.toMatchObject({ productId: "iron-id" });
    for (const invalid of [
      { ...valid, productId: "kordena-id" },
      { ...valid, secretRef: "env:FMCC_KORDENA_CONTROL_PLANE_TOKEN" },
      { ...valid, sourceType: "kordena-commercial-v1" },
      { ...valid, authoritativeDomain: "student-finance" },
      { ...valid, mappingVersion: "kordena-commercial-v1" },
      { ...valid, productId: undefined },
    ]) {
      await expect(service.register(owner, invalid)).rejects.toThrow("integration.product_source_binding_invalid");
    }
    expect(creates).toBe(1);
  });

});
