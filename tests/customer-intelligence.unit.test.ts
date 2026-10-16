import { describe, expect, it } from "vitest";
import { CustomerIntelligenceService } from "@/application/customer/customer-intelligence-service";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import type { TenantContext } from "@/domain/security/tenant-context";
import { computeMetric } from "@/domain/metrics/metric-engine";
import { getMetricDefinition } from "@/domain/metrics/registry";

const context: TenantContext = { tenantId: "tenant-customer", userId: "user-customer", role: "owner", correlationId: "corr-customer" };

function metric(metricId: string, value: string): MetricView {
  return {
    metricId, metricVersion: 1, value, unit: "count", computedAt: new Date(),
    freshnessStatus: "fresh", qualityStatus: "verified", sourceAuthority: "usage-support-authority",
    provenanceRefs: [`fact-${metricId}`],
  };
}

describe("F15 customer usage and support intelligence", () => {
  it("calcula DAU como usuários distintos sem expor fatos brutos", () => {
    const definition = getMetricDefinition("usage.active_users.dau")!;
    const ts = new Date("2026-09-22T00:00:00Z");
    expect(computeMetric(definition, [
      { id: "1", externalId: "user-1", factType: "usage.active_user.day", payload: {}, sourceTimestamp: ts, provenanceRef: "p1" },
      { id: "2", externalId: "user-1", factType: "usage.active_user.day", payload: {}, sourceTimestamp: ts, provenanceRef: "p2" },
      { id: "3", externalId: "user-2", factType: "usage.active_user.day", payload: {}, sourceTimestamp: ts, provenanceRef: "p3" },
    ])).toMatchObject({ status: "available", value: "2" });
  });

  it("mantém risco, adoção e experiência fail-closed", async () => {
    const values = new Map<string, MetricView>([
      ["usage.active_users.dau", metric("usage.active_users.dau", "12")],
      ["usage.engagement.events", metric("usage.engagement.events", "48")],
      ["support.ticket.open.count", metric("support.ticket.open.count", "3")],
    ]);
    const metrics = {
      async query(_context: TenantContext, metricId: string) { return values.get(metricId) ?? null; },
    } as unknown as MetricService;

    const result = await new CustomerIntelligenceService(metrics).overview(context);
    expect(result.factualSignals).toHaveLength(3);
    expect(result.customerRisk).toMatchObject({ status: "pending_semantics", score: null });
    expect(result.adoption.status).toBe("pending_semantics");
    expect(result.privacy.surface).toBe("aggregate_only");
    expect(JSON.stringify(result)).not.toContain("payload");
  });
});
