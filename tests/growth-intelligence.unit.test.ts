import { describe, expect, it } from "vitest";
import { GrowthIntelligenceService } from "@/application/growth/growth-intelligence-service";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import type { TenantContext } from "@/domain/security/tenant-context";
import { computeMetric } from "@/domain/metrics/metric-engine";
import { getMetricDefinition } from "@/domain/metrics/registry";

const context: TenantContext = { tenantId: "tenant-growth", userId: "user-growth", role: "owner", correlationId: "corr-growth" };

function metric(metricId: string, value: string): MetricView {
  return {
    metricId, metricVersion: 1, value, unit: "count", computedAt: new Date(),
    freshnessStatus: "fresh", qualityStatus: "verified", sourceAuthority: "commercial-authority",
    provenanceRefs: [`fact-${metricId}`],
  };
}

describe("F13 growth intelligence", () => {
  it("conta leads distintos por fonte governada", () => {
    const definition = getMetricDefinition("lead.created.count")!;
    const ts = new Date("2026-09-22T00:00:00Z");
    expect(computeMetric(definition, [
      { id: "1", externalId: "lead-1", factType: "lead.created", payload: {}, sourceTimestamp: ts, provenanceRef: "p1" },
      { id: "2", externalId: "lead-1", factType: "lead.created", payload: {}, sourceTimestamp: ts, provenanceRef: "p2" },
      { id: "3", externalId: "lead-2", factType: "lead.created", payload: {}, sourceTimestamp: ts, provenanceRef: "p3" },
    ])).toMatchObject({ status: "available", value: "2" });
  });

  it("não inventa conversão, CAC ou atribuição", async () => {
    const values = new Map<string, MetricView>([
      ["lead.created.count", metric("lead.created.count", "12")],
      ["trial.starts.count", metric("trial.starts.count", "5")],
    ]);
    const metrics = {
      async query(_context: TenantContext, metricId: string) { return values.get(metricId) ?? null; },
    } as unknown as MetricService;

    const result = await new GrowthIntelligenceService(metrics).overview(context);
    expect(result.metrics.find((item) => item.target.metricId === "lead.created.count")?.status).toBe("available");
    expect(result.metrics.find((item) => item.target.metricId === "trial.conversion.rate")?.status).toBe("pending_semantics");
    expect(result.metrics.find((item) => item.target.metricId === "acquisition.cac")?.status).toBe("pending_semantics");
    expect(result.attribution.status).toBe("pending_semantics");
  });
});
