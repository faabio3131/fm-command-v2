import { describe, expect, it, vi } from "vitest";
import { MetricRecomputeService } from "@/application/metrics/metric-recompute-service";
import { computeMetric, minorToDecimalText, type MetricFact } from "@/domain/metrics/metric-engine";
import { BASE_METRIC_REGISTRY, getMetricDefinition } from "@/domain/metrics/registry";

const fact = (id: string, factType: string, payload: Record<string, unknown>): MetricFact => ({ id, externalId: id, factType, payload, sourceTimestamp: new Date("2026-10-10T00:00:00Z"), provenanceRef: id });
const open = getMetricDefinition("finance.receivable.open_amount")!;
const overdue = getMetricDefinition("finance.receivable.overdue_amount")!;

describe("menor unidade da moeda para decimal exato", () => {
  it("converte sem ponto flutuante", () => {
    expect(minorToDecimalText(12345, 2)).toBe("123.45");
    expect(minorToDecimalText(5, 2)).toBe("0.05");
    expect(minorToDecimalText(0, 2)).toBe("0.00");
    expect(minorToDecimalText(-250, 2)).toBe("-2.50");
    expect(minorToDecimalText(1000, 0)).toBe("1000");
    expect(minorToDecimalText(1234, 3)).toBe("1.234");
  });
});

describe("métricas de receber e pagar vindas dos fatos do ERP", () => {
  const f = (id: string, status: string | undefined, amountMinor: number | undefined, currency = "BRL") =>
    fact(id, "finance.receivable", { ...(status ? { status } : {}), ...(amountMinor !== undefined ? { amountMinor } : {}), currency });

  it("em aberto soma aberto + vencido; vencido só o vencido; liquidado e cancelado ficam fora", () => {
    const facts = [f("a", "open", 10050), f("b", "overdue", 20025), f("c", "settled", 99999), f("d", "cancelled", 5)];
    expect(computeMetric(open, facts)).toMatchObject({ status: "available", value: "300.75", currency: "BRL" });
    expect(computeMetric(overdue, facts)).toMatchObject({ status: "available", value: "200.25" });
  });
  it("fato sem status reconhecido não conta (nunca é chutado)", () => {
    expect(computeMetric(open, [f("a", undefined, 1000), f("b", "open", 500)])).toMatchObject({ value: "5" });
  });
  it("título que casa com o filtro mas sem valor deixa a soma indisponível, nunca zero", () => {
    expect(computeMetric(open, [f("a", "open", 1000), f("b", "open", undefined)])).toMatchObject({ status: "missing", value: null });
  });
  it("sem nenhum título do tipo certo: indisponível", () => {
    expect(computeMetric(overdue, [f("a", "open", 1000)])).toMatchObject({ status: "missing", value: null });
  });
  it("moeda sem casas decimais não é dividida por cem", () => {
    expect(computeMetric(open, [f("a", "open", 1500, "JPY")])).toMatchObject({ value: "1500", currency: "JPY" });
  });
  it("duas moedas na mesma soma é erro (política de câmbio é decisão do dono)", () => {
    expect(() => computeMetric(open, [f("a", "open", 100, "BRL"), f("b", "open", 100, "USD")])).toThrow();
  });
  it("métricas antigas continuam iguais (sem status nem escala)", () => {
    const cash = getMetricDefinition("revenue.cash_collected")!;
    expect(computeMetric(cash, [fact("p", "payment.settled", { amount: "10.50", currency: "BRL" })])).toMatchObject({ value: "10.5" });
    // Só as métricas vindas de ERP (valor em centavos) usam a escala menor; as antigas não mudam.
    expect(BASE_METRIC_REGISTRY.filter((m) => m.valueScale === "minor").map((m) => m.metricId).sort()).toEqual([
      "finance.payable.open_amount", "finance.payable.overdue_amount", "finance.receivable.open_amount", "finance.receivable.overdue_amount", "sales.orders.invoiced_amount",
    ]);
  });
});

describe("recálculo a partir dos fatos", () => {
  const now = new Date("2026-10-16T15:00:00Z");
  function build(scopes: { factType: string; productId: string | null; unitId: string | null }[], failOn?: string) {
    const recompute = vi.fn(async (_c: unknown, input: { metricId: string }) => { if (input.metricId === failOn) throw new Error("x"); return {} as never; });
    const service = new MetricRecomputeService({
      metrics: { recompute } as never, factScopes: async () => scopes, tenantIds: async () => ["t1", "t2"], timeZone: async () => "America/Sao_Paulo", now: () => now,
    });
    return { service, recompute };
  }
  it("calcula só onde há fato: por métrica do tipo, produto e unidade", async () => {
    const { service, recompute } = build([
      { factType: "finance.receivable", productId: null, unitId: "u1" },
      { factType: "finance.receivable", productId: null, unitId: null },
      { factType: "finance.payable", productId: null, unitId: "u1" },
    ]);
    expect(await service.recomputeTenant("t1", "c")).toEqual({ computed: 6, failed: 0 }); // 2 métricas x 2 escopos + 2 métricas x 1 escopo
    const calls = recompute.mock.calls.map(([, i]) => i as { metricId: string; unitId?: string });
    expect(calls.filter((c) => c.metricId === "finance.payable.open_amount")).toHaveLength(1);
    expect(calls.filter((c) => c.metricId === "finance.receivable.open_amount").map((c) => c.unitId).sort()).toEqual(["u1", undefined]);
    expect(calls.every((c) => !c.metricId.startsWith("trial."))).toBe(true);
  });
  it("métrica de ponto no tempo leva 'asOf'; de período leva o mês corrente no fuso da empresa e não regrava igual", async () => {
    const { service, recompute } = build([
      { factType: "finance.receivable", productId: null, unitId: null },
      { factType: "lead.created", productId: null, unitId: null },
    ]);
    await service.recomputeTenant("t1", "c");
    const calls = recompute.mock.calls.map(([, i]) => i as Record<string, unknown>);
    // Posição tem um valor só; período tem um por tipo de período. O mês corrente é o que as telas leem por padrão.
    const byMetric = Object.fromEntries(calls.filter((i) => i.periodKind === undefined || i.periodKind === "current").map((i) => [i.metricId as string, i]));
    expect(byMetric["finance.receivable.open_amount"].asOf).toEqual(now);
    expect(byMetric["finance.receivable.open_amount"].periodStart).toBeUndefined();
    expect((byMetric["lead.created.count"].periodStart as Date).toISOString()).toBe("2026-10-01T03:00:00.000Z"); // 1º de outubro 00h em São Paulo
    expect(byMetric["lead.created.count"].periodEnd).toEqual(now);
    expect(byMetric["lead.created.count"].skipIfUnchanged).toBe(true);
    expect(calls.filter((i) => i.metricId === "finance.receivable.open_amount")).toHaveLength(1);
    const periods = Object.fromEntries(calls.filter((i) => i.metricId === "lead.created.count").map((i) => [i.periodKind as string, i]));
    expect(Object.keys(periods).sort()).toEqual(["current", "previous", "quarter", "year"]);
    const iso = (kind: string, key: "periodStart" | "periodEnd") => (periods[kind][key] as Date).toISOString();
    expect([iso("previous", "periodStart"), iso("previous", "periodEnd")]).toEqual(["2026-09-01T03:00:00.000Z", "2026-10-01T03:00:00.000Z"]);
    expect(iso("quarter", "periodStart")).toBe("2026-10-01T03:00:00.000Z");
    expect(iso("year", "periodStart")).toBe("2026-01-01T03:00:00.000Z");
  });
  it("uma métrica que falha não impede as outras e a falha é contada; uma empresa com problema não impede as outras", async () => {
    const { service } = build([{ factType: "finance.receivable", productId: null, unitId: null }], "finance.receivable.open_amount");
    expect(await service.recomputeTenant("t1", "c")).toEqual({ computed: 1, failed: 1 });
    expect(await service.recomputeAll("c")).toMatchObject({ tenants: 2, computed: 2, failed: 2 });
  });
});
