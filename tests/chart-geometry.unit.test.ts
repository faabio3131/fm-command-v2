import { describe, expect, it } from "vitest";
import { donutGeometry } from "@/app/dashboard/charts/donut-geometry";
import { lineGeometry } from "@/app/dashboard/charts/line-geometry";
import { changePercent, lastClosedDelta, toTrendPoints, type TrendPoint } from "@/domain/metrics/series-view";

const pt = (key: string, value: string | null, closed = true, currency = "BRL"): TrendPoint => ({ key, closed, value, currency: value === null ? undefined : currency, partial: false });

describe("variação percentual exata", () => {
  it("calcula com uma casa e arredonda meio para longe do zero", () => {
    expect(changePercent("1000", "1100")).toBe("10.0");
    expect(changePercent("1000", "900")).toBe("-10.0");
    expect(changePercent("3", "4")).toBe("33.3");
    expect(changePercent("8", "9")).toBe("12.5");
    expect(changePercent("1000", "1000")).toBe("0.0");
    expect(changePercent("1000.5", "2001")).toBe("100.0");
  });
  it("base zero, negativa ou texto inválido não tem percentual", () => {
    expect(changePercent("0", "10")).toBeNull();
    expect(changePercent("-5", "10")).toBeNull();
    expect(changePercent("abc", "10")).toBeNull();
  });
  it("variação muito pequena que arredonda para zero não ganha sinal negativo", () => {
    expect(changePercent("100000", "99999")).toBe("0.0");
  });
});

describe("variação entre os dois últimos meses fechados", () => {
  it("ignora o mês em andamento", () => {
    const d = lastClosedDelta([pt("2026-08", "100"), pt("2026-09", "150"), pt("2026-10", "10", false)]);
    expect(d).toMatchObject({ status: "available", percent: "50.0", direction: "up", fromKey: "2026-08", toKey: "2026-09" });
  });
  it("indisponível com menos de dois meses fechados, mês sem dado, moedas diferentes ou base zero", () => {
    expect(lastClosedDelta([pt("2026-09", "150"), pt("2026-10", "10", false)])).toEqual({ status: "unavailable", reason: "not_enough_months" });
    expect(lastClosedDelta([pt("2026-08", null), pt("2026-09", "150"), pt("2026-10", "1", false)])).toEqual({ status: "unavailable", reason: "no_data" });
    expect(lastClosedDelta([pt("2026-08", "10", true, "USD"), pt("2026-09", "150")])).toEqual({ status: "unavailable", reason: "mixed_currency" });
    expect(lastClosedDelta([pt("2026-08", "0"), pt("2026-09", "150")])).toEqual({ status: "unavailable", reason: "no_base" });
  });
  it("queda e estabilidade", () => {
    expect(lastClosedDelta([pt("a", "200"), pt("b", "100")])).toMatchObject({ direction: "down", percent: "-50.0" });
    expect(lastClosedDelta([pt("a", "200"), pt("b", "200")])).toMatchObject({ direction: "flat" });
  });
  it("converte o total consolidado: indisponível vira valor nulo, nunca zero", () => {
    const out = toTrendPoints([
      { key: "2026-09", closed: true, total: { status: "available", value: "10", currency: "BRL", reporting: 1, expected: 2, partial: true } },
      { key: "2026-10", closed: false, total: { status: "unavailable", reason: "no_data", reporting: 0, expected: 2 } },
    ]);
    expect(out).toEqual([
      { key: "2026-09", closed: true, value: "10", currency: "BRL", partial: true },
      { key: "2026-10", closed: false, value: null, partial: false },
    ]);
  });
});

describe("geometria da linha", () => {
  it("mês sem valor interrompe a linha em vez de ir a zero", () => {
    const g = lineGeometry([{ key: "a", value: "10", closed: true }, { key: "b", value: "20", closed: true }, { key: "c", value: null, closed: true }, { key: "d", value: "15", closed: true }, { key: "e", value: "30", closed: true }]);
    expect(g.solid).toHaveLength(2);
    expect(g.dots.map((d) => d.key)).toEqual(["a", "b", "d", "e"]);
    expect(g.ticks).toHaveLength(5);
  });
  it("o mês em andamento vira um trecho tracejado à parte", () => {
    const g = lineGeometry([{ key: "a", value: "10", closed: true }, { key: "b", value: "20", closed: true }, { key: "c", value: "5", closed: false }]);
    expect(g.solid).toHaveLength(1);
    expect(g.open).not.toBeNull();
  });
  it("o maior valor fica no topo e o zero na base; mês isolado vira só ponto", () => {
    const g = lineGeometry([{ key: "a", value: "100", closed: true }, { key: "b", value: null, closed: true }, { key: "c", value: "50", closed: true }]);
    const [a, c] = g.dots;
    expect(a.y).toBeLessThan(c.y);
    expect(a.y).toBeGreaterThan(0);
    expect(g.baselineY).toBeGreaterThan(c.y);
    expect(g.solid).toHaveLength(0);
    expect(g.dots).toHaveLength(2);
  });
  it("tudo sem dado não desenha nada nem quebra", () => {
    const g = lineGeometry([{ key: "a", value: null, closed: true }, { key: "b", value: null, closed: false }]);
    expect(g.solid).toEqual([]);
    expect(g.open).toBeNull();
    expect(g.dots).toEqual([]);
  });
  it("série de um mês só centraliza o ponto", () => {
    const g = lineGeometry([{ key: "a", value: "5", closed: true }], 320, 120);
    expect(g.dots[0].x).toBe(160);
  });
});

describe("geometria da rosca", () => {
  const items = [
    { id: "a", label: "A", valueText: "R$ 60", sharePercent: "60.0" },
    { id: "b", label: "B", valueText: "R$ 30", sharePercent: "30.0" },
    { id: "c", label: "C", valueText: null, sharePercent: null },
    { id: "d", label: "D", valueText: "R$ 10", sharePercent: "10.0" },
  ];
  it("fatias em ordem de participação, arcos encadeados e filial sem valor só na legenda", () => {
    const g = donutGeometry(items);
    expect(g.slices.map((s) => [s.id, s.dash, s.offset])).toEqual([["a", 60, -0], ["b", 30, -60], ["d", 10, -90]]);
    expect(g.unavailable.map((u) => u.id)).toEqual(["c"]);
    expect(g.othersPercent).toBeNull();
  });
  it("agrupa o excedente em 'outras' com a soma das participações", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: String(i), label: `F${i}`, valueText: "x", sharePercent: "12.5" }));
    const g = donutGeometry(many, 5);
    expect(g.slices).toHaveLength(5);
    expect(g.othersCount).toBe(3);
    expect(g.othersPercent).toBe("37.5");
  });
  it("sem participação (moedas diferentes) não desenha fatia", () => {
    const g = donutGeometry([{ id: "a", label: "A", valueText: "R$ 1", sharePercent: null }]);
    expect(g.slices).toEqual([]);
  });
});

import { deltaTone, higherIsWorse } from "@/domain/metrics/polarity";

describe("cor da variação conforme o sentido da métrica", () => {
  it("receita e leads: subir é bom, cair é ruim", () => {
    expect(deltaTone("billing.gross_billed", "up")).toBe("good");
    expect(deltaTone("lead.created.count", "down")).toBe("bad");
  });
  it("incidentes, falhas, custos e inadimplência: subir é ruim, cair é bom", () => {
    for (const id of ["incident.count", "job.failure.count", "cost.operating.total", "receivable.delinquent_amount", "subscription.cancelled.count"]) {
      expect(higherIsWorse(id)).toBe(true);
      expect(deltaTone(id, "up")).toBe("bad");
      expect(deltaTone(id, "down")).toBe("good");
    }
  });
  it("sem variação não tem cor de bom nem de ruim", () => {
    expect(deltaTone("incident.count", "flat")).toBe("flat");
    expect(deltaTone("billing.gross_billed", "flat")).toBe("flat");
  });
});
