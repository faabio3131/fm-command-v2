import { describe, expect, it } from "vitest";
import { CoreGateway } from "@/application/core/core-gateway";
import { FmccVerticalCognitiveCore } from "@/application/core/fmcc-vertical-cognitive-core";
import { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import type { CognitiveModel } from "@/domain/core/cognitive-model";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = { tenantId: "tenant-finance", userId: "user-finance", role: "owner", correlationId: "corr-finance" };
const periodStart = new Date("2026-09-01T00:00:00Z");
const periodEnd = new Date("2026-09-30T23:59:59Z");

function view(metricId: string, value: string | null): MetricView {
  return {
    metricId, metricVersion: 1, value, unit: "currency", currency: "BRL",
    periodStart, periodEnd, computedAt: new Date("2026-09-22T00:00:00Z"),
    sourceTimestamp: new Date("2026-09-22T00:00:00Z"),
    freshnessStatus: value === null ? "unavailable" : "fresh",
    qualityStatus: value === null ? "missing" : "verified",
    sourceAuthority: "governed-test-source", provenanceRefs: [`fact-${metricId}`],
  };
}

describe("F12 Core financial grounding", () => {
  it("entrega resultado operacional ao Core somente após cálculo determinístico", async () => {
    const values = new Map<string, MetricView>([
      ["revenue.cash_collected", view("revenue.cash_collected", "1000")],
      ["cost.infrastructure.total", view("cost.infrastructure.total", "200.1")],
      ["cost.operating.total", view("cost.operating.total", "99.9")],
    ]);
    const metrics = {
      async query(_context: TenantContext, metricId: string) { return values.get(metricId) ?? null; },
    } as unknown as MetricService;

    let factualValue: unknown;
    const model: CognitiveModel = {
      async plan(input) {
        expect(input.metricCatalog.some((item) => item.metricId === "finance.operating_result")).toBe(true);
        return { metricIds: ["finance.operating_result"] };
      },
      async synthesize(input) {
        factualValue = input.facts[0]?.value;
        return "Resultado operacional governado disponível.";
      },
    };

    const finance = new FinancialIntelligenceService(metrics);
    const answer = await new CoreGateway(
      new FmccVerticalCognitiveCore(model), metrics, undefined, undefined, finance,
    ).ask(context, "Estamos com resultado operacional positivo?");

    expect(factualValue).toBe("700");
    expect(answer.factualStatus).toBe("grounded");
    expect(answer.evidence[0]).toMatchObject({
      ref: "finance.operating_result",
      sourceAuthority: "fmcc_financial_intelligence",
    });
  });

  it("trata MetricView persistido com value null como indisponível", async () => {
    let synthesizeCalled = false;
    const model: CognitiveModel = {
      async plan() { return { metricIds: ["billing.gross_billed"] }; },
      async synthesize() { synthesizeCalled = true; return "não deveria"; },
    };
    const metrics = {
      async query() { return view("billing.gross_billed", null); },
    } as unknown as MetricService;

    const answer = await new CoreGateway(new FmccVerticalCognitiveCore(model), metrics).ask(context, "Quanto faturamos?");
    expect(answer.factualStatus).toBe("unavailable");
    expect(synthesizeCalled).toBe(false);
  });
});
