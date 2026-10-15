import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MetricService } from "@/application/metrics/metric-service";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { canonicalFacts, metricValues, productDefinitions, sourceDefinitions } from "@/infrastructure/db/platform-schema";
import { PostgresCanonicalFactRepository, PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

const TENANTS = ["f11-tenant-a", "f11-tenant-b"];

afterEach(async () => {
  for (const tenantId of TENANTS) {
    await db.delete(metricValues).where(eq(metricValues.tenantId, tenantId));
    await db.delete(canonicalFacts).where(eq(canonicalFacts.tenantId, tenantId));
    await db.delete(sourceDefinitions).where(eq(sourceDefinitions.tenantId, tenantId));
    await db.delete(productDefinitions).where(eq(productDefinitions.tenantId, tenantId));
  }
});

describe("F11 product scope PostgreSQL", () => {
  it("Product Registry não cruza tenant", async () => {
    const products = new PostgresProductRepository();
    const a = await products.create(TENANTS[0], { slug: "kordena", name: "Kordena" });
    await products.create(TENANTS[1], { slug: "kordena", name: "Kordena B" });
    expect((await products.list(TENANTS[0])).map((item) => item.id)).toEqual([a.id]);
    expect(await products.findById(TENANTS[1], a.id)).toBeNull();
  });

  it("Metric Engine isola fatos e valores por produto", async () => {
    const tenantId = TENANTS[0];
    const context: TenantContext = { tenantId, userId: "user", role: "owner", correlationId: "corr" };
    const products = new PostgresProductRepository();
    const productA = await products.create(tenantId, { slug: "kordena", name: "Kordena" });
    const productB = await products.create(tenantId, { slug: "iron", name: "IRON" });
    const sources = new PostgresSourceRepository();
    const sourceA = await sources.create(tenantId, { productId: productA.id, name: "Billing A", sourceType: "fixture", authoritativeDomain: "billing", syncMode: "pull" });
    const sourceB = await sources.create(tenantId, { productId: productB.id, name: "Billing B", sourceType: "fixture", authoritativeDomain: "billing", syncMode: "pull" });

    const facts = new PostgresCanonicalFactRepository();
    await facts.ingest({
      tenantId, productId: productA.id, sourceId: sourceA.id, mappingVersion: "v1", correlationId: "a",
      fact: { externalId: "invoice-a", factType: "billing.invoice", payload: { amount: "10", currency: "BRL" }, sourceTimestamp: new Date("2026-09-01T00:00:00Z") },
    });
    await facts.ingest({
      tenantId, productId: productB.id, sourceId: sourceB.id, mappingVersion: "v1", correlationId: "b",
      fact: { externalId: "invoice-b", factType: "billing.invoice", payload: { amount: "99", currency: "BRL" }, sourceTimestamp: new Date("2026-09-01T00:00:00Z") },
    });

    const metrics = new MetricService(new PostgresMetricStore());
    const valueA = await metrics.recompute(context, {
      productId: productA.id, metricId: "billing.gross_billed",
      periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T23:59:59Z"),
    });
    const valueB = await metrics.recompute(context, {
      productId: productB.id, metricId: "billing.gross_billed",
      periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T23:59:59Z"),
    });

    expect(valueA.value).toBe("10");
    expect(valueB.value).toBe("99");
    expect((await metrics.query(context, "billing.gross_billed", productA.id))?.value).toBe("10");
    expect(await metrics.query(context, "billing.gross_billed")).toBeNull();
  });
});
