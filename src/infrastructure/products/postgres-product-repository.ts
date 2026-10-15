import { and, eq } from "drizzle-orm";
import type { NewProductDefinition, ProductDefinition, ProductRepository } from "@/domain/products/contracts";
import { db } from "@/infrastructure/db/client";
import { productDefinitions } from "@/infrastructure/db/platform-schema";

function mapProduct(row: typeof productDefinitions.$inferSelect): ProductDefinition {
  return {
    id: row.id, tenantId: row.tenantId, slug: row.slug, name: row.name,
    status: row.status === "inactive" ? "inactive" : "active",
  };
}

export class PostgresProductRepository implements ProductRepository {
  async findById(tenantId: string, productId: string): Promise<ProductDefinition | null> {
    const rows = await db.select().from(productDefinitions).where(and(
      eq(productDefinitions.tenantId, tenantId), eq(productDefinitions.id, productId),
    )).limit(1);
    return rows[0] ? mapProduct(rows[0]) : null;
  }
  async findBySlug(tenantId: string, slug: string): Promise<ProductDefinition | null> {
    const rows = await db.select().from(productDefinitions).where(and(
      eq(productDefinitions.tenantId, tenantId), eq(productDefinitions.slug, slug),
    )).limit(1);
    return rows[0] ? mapProduct(rows[0]) : null;
  }
  async list(tenantId: string): Promise<readonly ProductDefinition[]> {
    const rows = await db.select().from(productDefinitions).where(eq(productDefinitions.tenantId, tenantId));
    return rows.map(mapProduct);
  }
  async create(tenantId: string, input: NewProductDefinition): Promise<ProductDefinition> {
    const rows = await db.insert(productDefinitions).values({
      tenantId, slug: input.slug, name: input.name, status: input.status ?? "active",
    }).returning();
    return mapProduct(rows[0]);
  }
}
