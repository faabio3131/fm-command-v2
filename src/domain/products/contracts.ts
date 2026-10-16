export type ProductStatus = "active" | "inactive";

export interface ProductDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly status: ProductStatus;
}

export interface NewProductDefinition {
  readonly slug: string;
  readonly name: string;
  readonly status?: ProductStatus;
}

export interface ProductRepository {
  findById(tenantId: string, productId: string): Promise<ProductDefinition | null>;
  findBySlug(tenantId: string, slug: string): Promise<ProductDefinition | null>;
  list(tenantId: string): Promise<readonly ProductDefinition[]>;
  create(tenantId: string, input: NewProductDefinition): Promise<ProductDefinition>;
}
