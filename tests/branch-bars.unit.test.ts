import { describe, expect, it } from "vitest";
import { buildBranchBars } from "@/app/dashboard/charts/branch-bars";
import type { RankedBranch, UnitComparison } from "@/domain/metrics/unit-comparison";

const branch = (unitId: string, name: string, value: string | null, rank: number | null, currency = "BRL"): RankedBranch =>
  ({ unitId, name, value, currency, rank, sharePercent: null });
const comparison = (branches: RankedBranch[], rankingSuspended = false): UnitComparison => ({
  regionId: null, total: { status: "unavailable", reason: "no_data", reporting: 0, expected: branches.length }, branches, rankingSuspended,
});

describe("buildBranchBars", () => {
  const base = comparison([branch("a", "Alfa", "100", 2), branch("b", "Beta", null, null), branch("c", "Gama", "400", 1), branch("d", "Delta", "50", 3)]);

  it("sem limite mostra todas as filiais na ordem recebida, com a indisponível sem barra", () => {
    const { items, unavailableCount, hiddenCount } = buildBranchBars(base, "currency", "pt-BR");
    expect(items.map((i) => i.label)).toEqual(["Alfa", "Beta", "Gama", "Delta"]);
    expect(items[1]).toMatchObject({ valueText: null, widthPercent: "0" });
    expect(unavailableCount).toBe(1);
    expect(hiddenCount).toBe(0);
  });

  it("com limite mostra as de maior valor por posição, conta as de fora e nunca inclui a indisponível", () => {
    const { items, unavailableCount, hiddenCount } = buildBranchBars(base, "currency", "pt-BR", 2);
    expect(items.map((i) => i.label)).toEqual(["Gama", "Alfa"]);
    expect(items[0].widthPercent).toBe("100");
    expect(hiddenCount).toBe(1);
    expect(unavailableCount).toBe(1);
    expect(items.every((i) => i.valueText !== null)).toBe(true);
  });

  it("a maior barra é a do maior valor e as demais são proporcionais", () => {
    const { items } = buildBranchBars(base, "count", "pt-BR", 5);
    expect(items.map((i) => [i.label, i.widthPercent])).toEqual([["Gama", "100"], ["Alfa", "25"], ["Delta", "12.5"]]);
  });

  it("ranking suspenso por moedas diferentes não desenha barra", () => {
    const mixed = comparison([branch("a", "Alfa", "100", null, "BRL"), branch("b", "Beta", "200", null, "USD")], true);
    const { items } = buildBranchBars(mixed, "currency", "pt-BR", 5);
    expect(items.every((i) => i.widthPercent === "0")).toBe(true);
  });

  it("formata moeda no idioma pedido", () => {
    const one = comparison([branch("a", "Alfa", "1234.5", 1)]);
    expect(buildBranchBars(one, "currency", "pt-BR").items[0].valueText).toContain("1.234,50");
    expect(buildBranchBars(one, "currency", "en-US").items[0].valueText).toContain("1,234.50");
  });

  it("sem filiais devolve vazio", () => {
    expect(buildBranchBars(comparison([]), "count", "pt-BR", 5)).toEqual({ items: [], hiddenCount: 0, unavailableCount: 0 });
  });
});
