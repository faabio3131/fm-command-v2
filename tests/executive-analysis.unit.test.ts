import { describe, expect, it } from "vitest";
import { ExecutiveAnalysisService } from "@/application/executive/executive-analysis-service";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import { computeExecutiveVariation } from "@/domain/executive/analysis";
import type { ProductDefinition, ProductRepository } from "@/domain/products/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = { tenantId: "tenant-exec", userId: "user-exec", role: "owner", correlationId: "corr-exec" };
const product: ProductDefinition = { id: "p1", tenantId: "tenant-exec", slug: "kordena", name: "Kordena", status: "active" };
const repo: ProductRepository = {
  async findById(tenantId, productId) { return tenantId === product.tenantId && productId === product.id ? product : null; },
  async findBySlug(tenantId, slug) { return tenantId === product.tenantId && slug === product.slug ? product : null; },
  async list(tenantId) { return tenantId === product.tenantId ? [product] : []; },
  async create() { throw new Error("unused"); },
};

function view(metricId: string, value: string | null, period: "current" | "previous" = "current", currency = "BRL"): MetricView {
  const current = period === "current";
  return {
    productId: "p1", metricId, metricVersion: 1, value, unit: metricId.includes("billing") || metricId.includes("revenue") ? "currency" : "count",
    currency: metricId.includes("billing") || metricId.includes("revenue") ? currency : undefined,
    periodStart: new Date(current ? "2026-09-01T00:00:00Z" : "2026-08-01T00:00:00Z"),
    periodEnd: new Date(current ? "2026-09-30T23:59:59Z" : "2026-08-31T23:59:59Z"),
    computedAt: new Date(current ? "2026-09-30T23:59:59Z" : "2026-08-31T23:59:59Z"),
    freshnessStatus: value === null ? "unavailable" : "fresh",
    qualityStatus: value === null ? "missing" : "verified",
    sourceAuthority: "governed-test-source",
    provenanceRefs: [`fact-${metricId}-${period}`],
  };
}

describe("F16 advanced executive analysis", () => {
  it("calcula delta decimal exato e preserva provenance", () => {
    const result = computeExecutiveVariation([
      view("billing.gross_billed", "1000.10"),
      view("billing.gross_billed", "900.05", "previous"),
    ]);
    expect(result).toMatchObject({ status: "available", direction: "increased", delta: "100.05" });
    expect(result.provenanceRefs).toHaveLength(2);
  });

  it("falha fechado em moeda incompatível", () => {
    expect(computeExecutiveVariation([
      view("billing.gross_billed", "100", "current", "BRL"),
      view("billing.gross_billed", "90", "previous", "USD"),
    ])).toMatchObject({ status: "incompatible", reason: "currency" });
  });

  it("não fabrica anomalia, risco ou previsão sem política suficiente", async () => {
    const metrics = {
      async query(_context: TenantContext, metricId: string) {
        return metricId === "billing.gross_billed" ? view(metricId, "1000") : null;
      },
      async history(_context: TenantContext, metricId: string) {
        return metricId === "billing.gross_billed"
          ? [view(metricId, "1000"), view(metricId, "900", "previous")]
          : [];
      },
    } as unknown as MetricService;
    const result = await new ExecutiveAnalysisService(metrics, repo).overview(context, {
      productId: "p1",
      metricIds: ["billing.gross_billed", "incident.count"],
    });
    expect(result.signals[0].variation).toMatchObject({ status: "available", delta: "100" });
    expect(result.signals[1].status).toBe("unavailable");
    expect(result.anomaly.status).toBe("insufficient_evidence");
    expect(result.risk.status).toBe("insufficient_evidence");
    expect(result.forecast.status).toBe("insufficient_evidence");
    expect(result.correlation.status).toBe("insufficient_evidence");
  });
});
