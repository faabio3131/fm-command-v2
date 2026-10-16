import { describe, expect, it } from "vitest";
import { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import { computeOperatingResult } from "@/domain/finance/operating-result";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = { tenantId: "tenant-f", userId: "user-f", role: "owner", correlationId: "corr-f" };
const periodStart = new Date("2026-09-01T00:00:00Z");
const periodEnd = new Date("2026-09-30T23:59:59Z");

function metric(metricId: string, value: string | null, currency = "BRL"): MetricView {
  return {
    metricId, metricVersion: 1, value, unit: "currency", currency,
    periodStart, periodEnd, computedAt: new Date("2026-09-22T00:00:00Z"),
    sourceTimestamp: new Date("2026-09-22T00:00:00Z"),
    freshnessStatus: value === null ? "unavailable" : "fresh",
    qualityStatus: value === null ? "missing" : "verified",
    sourceAuthority: "test-authority", provenanceRefs: [`fact-${metricId}`],
  };
}

describe("F12 financial intelligence", () => {
  it("calcula resultado operacional com decimal exato", () => {
    const result = computeOperatingResult(
      metric("revenue.cash_collected", "1000"),
      metric("cost.infrastructure.total", "200.1"),
      metric("cost.operating.total", "99.9"),
    );
    expect(result).toMatchObject({ status: "available", value: "700", currency: "BRL", direction: "profit" });
  });

  it("falha fechado quando falta entrada", () => {
    expect(computeOperatingResult(
      metric("revenue.cash_collected", "1000"),
      null,
      metric("cost.operating.total", "100"),
    )).toEqual({ status: "unavailable", reason: "missing_input" });
  });

  it("recusa moeda incompatível", () => {
    expect(computeOperatingResult(
      metric("revenue.cash_collected", "1000", "BRL"),
      metric("cost.infrastructure.total", "100", "USD"),
      metric("cost.operating.total", "100", "BRL"),
    )).toEqual({ status: "incompatible", reason: "currency" });
  });

  it("não fabrica unit economics nem métricas sem valor governado", async () => {
    const values = new Map<string, MetricView>([
      ["revenue.cash_collected", metric("revenue.cash_collected", "1000")],
    ]);
    const metrics = {
      async query(_context: TenantContext, metricId: string) { return values.get(metricId) ?? null; },
    } as unknown as MetricService;

    const result = await new FinancialIntelligenceService(metrics).overview(context);
    expect(result.metrics.find((item) => item.target.metricId === "cost.infrastructure.total")?.status).toBe("unavailable");
    expect(result.operatingResult.status).toBe("unavailable");
    expect(result.unitEconomics.every((item) => item.status === "pending_semantics")).toBe(true);
  });
});
