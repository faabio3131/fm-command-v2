import { describe, expect, it } from "vitest";
import { ProductDefinitionInvalidError, ProductRegistryService, ProductSlugConflictError } from "@/application/products/product-registry-service";
import type { NewProductDefinition, ProductDefinition, ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

const owner: TenantContext = { tenantId: "tenant-a", userId: "user-a", role: "owner", correlationId: "corr-a" };

function repo(seed: ProductDefinition[] = []): ProductRepository {
  const rows = [...seed];
  return {
    async findById(tenantId, productId) { return rows.find((p) => p.tenantId === tenantId && p.id === productId) ?? null; },
    async findBySlug(tenantId, slug) { return rows.find((p) => p.tenantId === tenantId && p.slug === slug) ?? null; },
    async list(tenantId) { return rows.filter((p) => p.tenantId === tenantId); },
    async create(tenantId: string, input: NewProductDefinition) {
      const product: ProductDefinition = {
        id: `product-${rows.length + 1}`, tenantId, slug: input.slug, name: input.name, status: input.status ?? "active",
      };
      rows.push(product);
      return product;
    },
  };
}

describe("F11 Product Registry", () => {
  it("cria e lista somente produtos do tenant", async () => {
    const service = new ProductRegistryService(repo());
    const created = await service.register(owner, { slug: "kordena", name: "Kordena" });
    expect(created).toMatchObject({ tenantId: "tenant-a", slug: "kordena", status: "active" });
    await expect(service.list(owner)).resolves.toEqual([created]);
  });
  it("rejeita slug inválido", async () => {
    await expect(new ProductRegistryService(repo()).register(owner, { slug: "Kordena IA", name: "Kordena" }))
      .rejects.toBeInstanceOf(ProductDefinitionInvalidError);
  });
  it("rejeita slug duplicado no mesmo tenant", async () => {
    const service = new ProductRegistryService(repo([{ id: "p1", tenantId: "tenant-a", slug: "kordena", name: "Kordena", status: "active" }]));
    await expect(service.register(owner, { slug: "kordena", name: "Outro" })).rejects.toBeInstanceOf(ProductSlugConflictError);
  });
  it("RBAC impede escrita por viewer", async () => {
    const viewer: TenantContext = { ...owner, role: "viewer" };
    await expect(new ProductRegistryService(repo()).register(viewer, { slug: "kordena", name: "Kordena" }))
      .rejects.toThrow("security.permission_denied:product:write");
  });
});
