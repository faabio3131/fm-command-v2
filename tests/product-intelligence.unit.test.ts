import { describe, expect, it } from "vitest";
import { ProductIntelligenceService } from "@/application/products/product-intelligence-service";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import type { ProductDefinition, ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = { tenantId: "tenant-a", userId: "user-a", role: "owner", correlationId: "corr-a" };
const products: ProductDefinition[] = [
  { id: "p1", tenantId: "tenant-a", slug: "kordena", name: "Kordena", status: "active" },
  { id: "p2", tenantId: "tenant-a", slug: "iron", name: "IRON", status: "active" },
];

function productRepo(): ProductRepository {
  return {
    async findById(tenantId, productId) { return products.find((p) => p.tenantId === tenantId && p.id === productId) ?? null; },
    async findBySlug(tenantId, slug) { return products.find((p) => p.tenantId === tenantId && p.slug === slug) ?? null; },
    async list(tenantId) { return products.filter((p) => p.tenantId === tenantId); },
    async create() { throw new Error("unused"); },
  };
}

function view(productId: string, value: string, currency = "BRL", periodStart = "2026-09-01T00:00:00Z", periodEnd = "2026-09-30T23:59:59Z"): MetricView {
  return {
    productId, metricId: "billing.gross_billed", metricVersion: 1, value, unit: "currency", currency,
    periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), computedAt: new Date(periodEnd),
    freshnessStatus: "fresh", qualityStatus: "verified", sourceAuthority: "billing", provenanceRefs: [`fact-${productId}`],
  };
}

describe("F11 Product Intelligence", () => {
  it("mantém semântica pendente e missing explícitos no overview", async () => {
    const metrics = {
      async query(_context: TenantContext, metricId: string, productId?: string) {
        return metricId === "billing.gross_billed" ? view(productId as string, "100") : null;
      },
      async history() { return []; },
    } as unknown as MetricService;

    const result = await new ProductIntelligenceService(productRepo(), metrics).overview(context, "p1");
    expect(result.product.slug).toBe("kordena");
    expect(result.metrics.find((item) => item.target.metricId === "activation.rate")?.status).toBe("pending_semantics");
    expect(result.metrics.find((item) => item.target.metricId === "trial.starts.count")?.status).toBe("unavailable");
    expect(result.metrics.find((item) => item.target.metricId === "billing.gross_billed")?.status).toBe("available");
  });

  it("deriva growth apenas de duas observações comparáveis", async () => {
    const current = view("p1", "120", "BRL", "2026-09-01T00:00:00Z", "2026-09-30T23:59:59Z");
    const previous = view("p1", "100", "BRL", "2026-08-01T00:00:00Z", "2026-08-31T23:59:59Z");
    const metrics = {
      async query() { return null; },
      async history(_context: TenantContext, metricId: string) {
        return metricId === "billing.gross_billed" ? [current, previous] : [];
      },
    } as unknown as MetricService;

    const result = await new ProductIntelligenceService(productRepo(), metrics).overview(context, "p1");
    expect(result.growth.find((item) => item.metricId === "billing.gross_billed")).toMatchObject({
      status: "available", direction: "increased",
    });
  });

  it("bloqueia comparação de currencies incompatíveis", async () => {
    const metrics = {
      async query(_context: TenantContext, _metricId: string, productId?: string) {
        return productId === "p1" ? view("p1", "100", "BRL") : view("p2", "20", "USD");
      },
    } as unknown as MetricService;
    const result = await new ProductIntelligenceService(productRepo(), metrics)
      .compare(context, "billing.gross_billed", ["p1", "p2"]);
    expect(result.status).toBe("incompatible_currency");
  });

  it("não converte produto sem valor em zero durante comparação", async () => {
    const metrics = {
      async query(_context: TenantContext, _metricId: string, productId?: string) {
        return productId === "p1" ? view("p1", "100") : null;
      },
    } as unknown as MetricService;
    const result = await new ProductIntelligenceService(productRepo(), metrics)
      .compare(context, "billing.gross_billed", ["p1", "p2"]);
    expect(result.status).toBe("unavailable");
  });
});
