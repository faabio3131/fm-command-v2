import type { NewProductDefinition, ProductDefinition, ProductRepository } from "@/domain/products/contracts";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

export class ProductNotFoundError extends Error { constructor() { super("product.not_found"); } }
export class ProductSlugConflictError extends Error { constructor() { super("product.slug_conflict"); } }
export class ProductDefinitionInvalidError extends Error { constructor() { super("product.definition_invalid"); } }

const PRODUCT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ProductRegistryService {
  constructor(private readonly products: ProductRepository) {}

  async list(context: TenantContext): Promise<readonly ProductDefinition[]> {
    requirePermission(context, "product:read");
    return this.products.list(context.tenantId);
  }

  async get(context: TenantContext, productId: string): Promise<ProductDefinition> {
    requirePermission(context, "product:read");
    const product = await this.products.findById(context.tenantId, productId);
    if (!product) throw new ProductNotFoundError();
    return product;
  }

  async findBySlug(context: TenantContext, slug: string): Promise<ProductDefinition | null> {
    requirePermission(context, "product:read");
    return this.products.findBySlug(context.tenantId, slug);
  }

  async register(context: TenantContext, input: NewProductDefinition): Promise<ProductDefinition> {
    requirePermission(context, "product:write");
    const slug = input.slug.trim();
    const name = input.name.trim();
    if (!PRODUCT_SLUG.test(slug) || name.length < 2 || name.length > 120) throw new ProductDefinitionInvalidError();
    if (await this.products.findBySlug(context.tenantId, slug)) throw new ProductSlugConflictError();
    return this.products.create(context.tenantId, { slug, name, status: input.status ?? "active" });
  }
}
