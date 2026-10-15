import { describe, expect, it } from "vitest";
import { CoreGateway } from "@/application/core/core-gateway";
import { FmccVerticalCognitiveCore } from "@/application/core/fmcc-vertical-cognitive-core";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import type { CognitiveModel } from "@/domain/core/cognitive-model";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = { tenantId: "tenant-core-customer", userId: "user-core-customer", role: "owner", correlationId: "corr-core-customer" };

function metric(metricId: string, value: string): MetricView {
  return {
    metricId, metricVersion: 1, value, unit: "count", computedAt: new Date(),
    freshnessStatus: "fresh", qualityStatus: "verified", sourceAuthority: "aggregate-usage-support",
    provenanceRefs: [`aggregate-${metricId}`],
  };
}

describe("F15 Core customer intelligence grounding", () => {
  it("sintetiza uso e suporte somente a partir de agregados governados", async () => {
    const model: CognitiveModel = {
      async plan(input) {
        expect(input.metricCatalog.some((item) => item.metricId === "usage.active_users.dau")).toBe(true);
        expect(input.metricCatalog.some((item) => item.metricId === "support.ticket.open.count")).toBe(true);
        return { metricIds: ["usage.active_users.dau", "support.ticket.open.count"] };
      },
      async synthesize(input) {
        expect(input.facts).toEqual(expect.arrayContaining([
          expect.objectContaining({ metricId: "usage.active_users.dau", value: "12" }),
          expect.objectContaining({ metricId: "support.ticket.open.count", value: "3" }),
        ]));
        expect(JSON.stringify(input.facts)).not.toContain("email");
        return "Uso e suporte governados.";
      },
    };

    const values = new Map([
      ["usage.active_users.dau", metric("usage.active_users.dau", "12")],
      ["support.ticket.open.count", metric("support.ticket.open.count", "3")],
    ]);
    const metrics = {
      async query(_context: TenantContext, metricId: string) { return values.get(metricId) ?? null; },
    } as unknown as MetricService;

    const answer = await new CoreGateway(new FmccVerticalCognitiveCore(model), metrics)
      .ask(context, "Como estão uso e suporte?");
    expect(answer.factualStatus).toBe("grounded");
    expect(answer.evidence).toHaveLength(2);
  });
});
