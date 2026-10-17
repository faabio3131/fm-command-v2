import { describe, expect, it } from "vitest";
import { rankByDimension } from "@/domain/metrics/dimension-ranking";
import type { MetricFact } from "@/domain/metrics/metric-engine";
import { getMetricDefinition } from "@/domain/metrics/registry";

const def = getMetricDefinition("sales.items.invoiced_amount")!;
let n = 0;
const item = (productRef: string | undefined, amountMinor: number | undefined, over: Record<string, unknown> = {}): MetricFact => ({
  id: `f${++n}`, externalId: `order:${n}:item:1`, factType: "sales.order_item", provenanceRef: `f${n}`, sourceTimestamp: new Date(2026, 9, 5 + (n % 20)),
  payload: { status: "invoiced", currency: "BRL", ...(productRef ? { productRef } : {}), ...(amountMinor !== undefined ? { amountMinor } : {}), ...over },
});

describe("ranking por dimensão (produto)", () => {
  it("soma por produto, ordena do maior ao menor e calcula a participação", () => {
    const r = rankByDimension(def, [item("A", 60000), item("B", 40000), item("A", 30000), item("C", 10000)], "productRef");
    expect(r.rows.map((x) => [x.key, x.value, x.rank, x.sharePercent])).toEqual([["A", "900", 1, "64.3"], ["B", "400", 2, "28.6"], ["C", "100", 3, "7.1"]]);
    expect(r.total).toEqual({ value: "1400", currency: "BRL" });
    expect(r.withoutDimension).toBe(0);
    expect(r.rankingSuspended).toBe(false);
  });

  it("empate divide a posição e usa a descrição mais recente como nome", () => {
    const r = rankByDimension(def, [item("A", 5000, { description: "Camisa" }), item("B", 5000), item("C", 100)], "productRef");
    expect(r.rows.map((x) => [x.key, x.rank])).toEqual([["A", 1], ["B", 1], ["C", 3]]);
    expect(r.rows[0].label).toBe("Camisa");
    expect(r.rows[1].label).toBe("B");
  });

  it("linha sem código de produto não entra em nenhum grupo e é contada à parte", () => {
    const r = rankByDimension(def, [item("A", 1000), item(undefined, 99999), item("  ", 5)], "productRef");
    expect(r.rows.map((x) => x.key)).toEqual(["A"]);
    expect(r.withoutDimension).toBe(2);
    expect(r.total).toEqual({ value: "10", currency: "BRL" });
  });

  it("produto com valor indisponível não vira zero: fica sem posição, fora da soma e depois dos demais", () => {
    const r = rankByDimension(def, [item("A", 1000), item("B", undefined)], "productRef");
    expect(r.rows.map((x) => [x.key, x.value, x.rank])).toEqual([["A", "10", 1], ["B", null, null]]);
    expect(r.total).toEqual({ value: "10", currency: "BRL" });
  });

  it("moedas diferentes entre produtos suspendem o ranking e o total; dentro de um produto o torna indisponível", () => {
    const mixedAcross = rankByDimension(def, [item("A", 1000), item("B", 2000, { currency: "USD" })], "productRef");
    expect(mixedAcross.rankingSuspended).toBe(true);
    expect(mixedAcross.total).toBeNull();
    expect(mixedAcross.rows.every((x) => x.rank === null && x.sharePercent === null)).toBe(true);
    const mixedWithin = rankByDimension(def, [item("A", 1000), item("A", 2000, { currency: "USD" }), item("B", 500)], "productRef");
    expect(mixedWithin.rows.find((x) => x.key === "A")).toMatchObject({ value: null, rank: null });
    expect(mixedWithin.rows.find((x) => x.key === "B")).toMatchObject({ value: "5", rank: 1 });
  });

  it("status que a métrica não aceita fica de fora (cancelado, em aberto) e fato de outro tipo também", () => {
    const r = rankByDimension(def, [item("A", 1000), item("A", 9000, { status: "cancelled" }), item("A", 9000, { status: "open" }), { ...item("A", 9000), factType: "sales.order" }], "productRef");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].value).toBe("10");
  });

  it("sem fato nenhum, não há linhas nem total", () => {
    expect(rankByDimension(def, [], "productRef")).toMatchObject({ rows: [], total: null, withoutDimension: 0 });
  });

  it("recusa dimensão que a métrica não declara e métrica que não soma nem conta", () => {
    expect(() => rankByDimension(def, [], "color")).toThrow("metrics.dimension_not_supported");
    const ratio = { ...def, kind: "ratio" } as unknown as typeof def;
    expect(() => rankByDimension(ratio, [], "productRef")).toThrow("metrics.ranking_kind_invalid");
  });
});
