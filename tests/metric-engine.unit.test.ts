import { describe, expect, it } from "vitest";
import { computeMetric } from "@/domain/metrics/metric-engine";
import { getMetricDefinition } from "@/domain/metrics/registry";

describe("F08 deterministic Metric Engine", () => {
  it("mantém contrato governado completo para cada definição", () => {
    for (const definition of ["trial.starts.count", "subscription.active.count", "subscription.cancelled.count", "billing.gross_billed", "revenue.cash_collected"].map((id) => getMetricDefinition(id)!)) {
      expect(definition.calculationVersion).toBeTruthy();
      expect(definition.description).toBeTruthy();
      expect(["period", "as_of"]).toContain(definition.grain);
      expect(Array.isArray(definition.dimensions)).toBe(true);
      expect(["bounded_period", "as_of"]).toContain(definition.timeWindow);
      expect(definition.freshnessPolicy).toBe("source_governed");
      expect(definition.sourceAuthority).toBeTruthy();
    }
  });

  it("mantém missing diferente de zero", () => {
    const definition = getMetricDefinition("trial.starts.count")!;
    expect(computeMetric(definition, [])).toMatchObject({ status: "missing", value: null, qualityStatus: "missing" });
  });

  it("conta IDs distintos determinísticamente", () => {
    const definition = getMetricDefinition("trial.starts.count")!;
    const ts = new Date("2026-09-20T00:00:00Z");
    const result = computeMetric(definition, [
      { id: "1", externalId: "trial-1", factType: "trial.started", payload: {}, sourceTimestamp: ts, provenanceRef: "p1" },
      { id: "2", externalId: "trial-1", factType: "trial.started", payload: {}, sourceTimestamp: ts, provenanceRef: "p2" },
      { id: "3", externalId: "trial-2", factType: "trial.started", payload: {}, sourceTimestamp: ts, provenanceRef: "p3" },
    ]);
    expect(result).toMatchObject({ status: "available", value: "2", unit: "count" });
  });

  it("soma valores financeiros sem erro de ponto flutuante", () => {
    const definition = getMetricDefinition("billing.gross_billed")!;
    const ts = new Date("2026-09-20T00:00:00Z");
    const result = computeMetric(definition, [
      { id: "1", externalId: "i1", factType: "billing.invoice", payload: { amount: "0.1", currency: "BRL" }, sourceTimestamp: ts, provenanceRef: "p1" },
      { id: "2", externalId: "i2", factType: "billing.invoice", payload: { amount: "0.2", currency: "BRL" }, sourceTimestamp: ts, provenanceRef: "p2" },
    ]);
    expect(result).toMatchObject({ status: "available", value: "0.3", currency: "BRL" });
  });

  it("recusa somar moedas diferentes sem política FX", () => {
    const definition = getMetricDefinition("billing.gross_billed")!;
    const ts = new Date("2026-09-20T00:00:00Z");
    expect(() => computeMetric(definition, [
      { id: "1", externalId: "i1", factType: "billing.invoice", payload: { amount: 10, currency: "BRL" }, sourceTimestamp: ts, provenanceRef: "p1" },
      { id: "2", externalId: "i2", factType: "billing.invoice", payload: { amount: 5, currency: "USD" }, sourceTimestamp: ts, provenanceRef: "p2" },
    ])).toThrow("metrics.fx_policy_required");
  });

  it("não transforma valor inválido em zero", () => {
    const definition = getMetricDefinition("billing.gross_billed")!;
    const result = computeMetric(definition, [
      { id: "1", externalId: "i1", factType: "billing.invoice", payload: { amount: "unknown", currency: "BRL" }, sourceTimestamp: new Date(), provenanceRef: "p1" },
    ]);
    expect(result).toMatchObject({ status: "missing", value: null });
  });
});
