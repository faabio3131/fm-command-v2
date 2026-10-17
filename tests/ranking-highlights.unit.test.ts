import { describe, expect, it } from "vitest";
import { rankingHighlights } from "@/domain/metrics/ranking-highlights";
import { compareBranches, type UnitReading } from "@/domain/metrics/unit-comparison";
import type { OrgUnit } from "@/domain/organization/unit-hierarchy";

const unit = (id: string): OrgUnit => ({ id, tenantId: "t", kind: "branch", parentId: null, name: id, status: "active" } as OrgUnit);
const branches = ["A", "B", "C", "D"].map(unit);
const read = (rows: Record<string, string | null>, currency = "BRL"): UnitReading[] => Object.entries(rows).map(([unitId, value]) => ({ unitId, value, currency }));
const hi = (rows: Record<string, string | null>, ids = ["A", "B", "C", "D"], currency = "BRL") =>
  rankingHighlights(compareBranches(ids.map(unit), read(rows, currency), null));
const names = (p: { branches: readonly { name: string }[] }) => p.branches.map((b) => b.name);

describe("destaques do ranking de filiais", () => {
  it("entrega maior, segunda, terceira e menor, com os valores do motor", () => {
    const h = hi({ A: "182400", B: "151900", C: "97300", D: "41200" });
    expect(h.status).toBe("available");
    if (h.status !== "available") return;
    expect(h.positions.map((p) => [p.position, names(p)])).toEqual([[1, ["A"]], [2, ["B"]], [3, ["C"]]]);
    expect(h.positions[0].branches[0]).toMatchObject({ value: "182400", currency: "BRL" });
    expect(h.lowest?.map((b) => b.name)).toEqual(["D"]);
    expect(h.partial).toBe(false);
  });
  it("empate divide a posição: a segunda não existe quando duas empatam em primeiro", () => {
    const h = hi({ A: "100", B: "100", C: "50", D: "10" });
    if (h.status !== "available") throw new Error("esperava disponível");
    expect(h.positions.map((p) => [p.position, names(p)])).toEqual([[1, ["A", "B"]], [3, ["C"]]]);
    expect(h.lowest?.map((b) => b.name)).toEqual(["D"]);
  });
  it("empate no último lugar lista todas as empatadas", () => {
    const h = hi({ A: "100", B: "50", C: "10", D: "10" });
    if (h.status !== "available") throw new Error("esperava disponível");
    expect(h.lowest?.map((b) => b.name)).toEqual(["C", "D"]);
  });
  it("filial sem valor não ganha posição, não vira zero e aparece à parte", () => {
    const h = hi({ A: "100", B: "50", C: null });
    if (h.status !== "available") throw new Error("esperava disponível");
    expect(h.positions.flatMap(names)).toEqual(["A", "B"]);
    expect(h.lowest?.map((b) => b.name)).toEqual(["B"]);
    expect(h.withoutValue).toEqual(["C", "D"]);
    expect(h).toMatchObject({ reporting: 2, expected: 4, partial: true });
  });
  it("com uma só filial com valor há primeira posição mas nenhum 'menor'", () => {
    const h = hi({ A: "100", B: null });
    if (h.status !== "available") throw new Error("esperava disponível");
    expect(h.positions.flatMap(names)).toEqual(["A"]);
    expect(h.lowest).toBeNull();
  });
  it("todas empatadas: não há menor distinto do maior", () => {
    const h = hi({ A: "7", B: "7" });
    if (h.status !== "available") throw new Error("esperava disponível");
    expect(h.positions.map((p) => names(p))).toEqual([["A", "B"]]);
    expect(h.lowest).toBeNull();
  });
  it("moedas diferentes suspendem o ranking; sem dado e sem filiais são indisponíveis com o motivo", () => {
    const mixed = rankingHighlights(compareBranches(branches.slice(0, 2), [{ unitId: "A", value: "10", currency: "BRL" }, { unitId: "B", value: "20", currency: "USD" }], null));
    expect(mixed).toMatchObject({ status: "unavailable", reason: "mixed_currency" });
    expect(hi({ A: null, B: null }, ["A", "B"])).toMatchObject({ status: "unavailable", reason: "no_data" });
    expect(hi({}, [])).toMatchObject({ status: "unavailable", reason: "no_branches" });
  });
});
