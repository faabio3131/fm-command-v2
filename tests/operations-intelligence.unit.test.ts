import { describe, expect, it } from "vitest";
import { OperationsIntelligenceService } from "@/application/operations/operations-intelligence-service";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import type { TenantContext } from "@/domain/security/tenant-context";
import { computeMetric } from "@/domain/metrics/metric-engine";
import { getMetricDefinition } from "@/domain/metrics/registry";

const context: TenantContext = { tenantId: "tenant-ops", userId: "user-ops", role: "owner", correlationId: "corr-ops" };

function metric(metricId: string, value: string): MetricView {
  return {
    metricId, metricVersion: 1, value, unit: "count", computedAt: new Date(),
    freshnessStatus: "fresh", qualityStatus: "verified", sourceAuthority: "observability-authority",
    provenanceRefs: [`fact-${metricId}`],
  };
}

describe("F14 operations intelligence", () => {
  it("conta incidentes distintos deterministicamente", () => {
    const definition = getMetricDefinition("incident.count")!;
    const ts = new Date("2026-09-22T00:00:00Z");
    expect(computeMetric(definition, [
      { id: "1", externalId: "inc-1", factType: "incident.opened", payload: {}, sourceTimestamp: ts, provenanceRef: "p1" },
      { id: "2", externalId: "inc-1", factType: "incident.opened", payload: {}, sourceTimestamp: ts, provenanceRef: "p2" },
      { id: "3", externalId: "inc-2", factType: "incident.opened", payload: {}, sourceTimestamp: ts, provenanceRef: "p3" },
    ])).toMatchObject({ status: "available", value: "2" });
  });

  it("não registra percentual de disponibilidade sem semântica temporal aprovada", () => {
    expect(getMetricDefinition("service.availability.rate")).toBeNull();
    expect(getMetricDefinition("service.error.rate")).toBeNull();
  });

  it("não transforma health pontual em disponibilidade inventada", async () => {
    const values = new Map<string, MetricView>([
      ["incident.count", metric("incident.count", "1")],
      ["service.error.count", metric("service.error.count", "4")],
    ]);
    const metrics = {
      async query(_context: TenantContext, metricId: string) { return values.get(metricId) ?? null; },
    } as unknown as MetricService;

    const result = await new OperationsIntelligenceService(metrics).overview(context);
    expect(result.metrics.find((item) => item.target.metricId === "incident.count")?.status).toBe("available");
    expect(result.metrics.find((item) => item.target.metricId === "service.availability.rate")?.status).toBe("pending_semantics");
    expect(result.availability.status).toBe("pending_semantics");
    expect(result.alerts.status).toBe("signals_only");
  });
});
