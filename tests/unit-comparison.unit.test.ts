import { describe, expect, it } from "vitest";
import { compareDecimals, parseDecimal, percentOfTotal } from "../src/domain/core/decimal";
import { compareBranches, RegionOutOfScopeError, selectableRegions, selectBranches } from "../src/domain/metrics/unit-comparison";
import type { OrgUnit, UnitScope } from "../src/domain/organization/unit-hierarchy";

const T = "t1";
const unit = (id: string, kind: OrgUnit["kind"], parentId: string | null, name: string): OrgUnit => ({ id, tenantId: T, parentId, kind, name });
const UNITS: OrgUnit[] = [
  unit("co", "company", null, "Matriz"),
  unit("sul", "region", "co", "Sul"),
  unit("norte", "region", "co", "Norte"),
  unit("b1", "branch", "sul", "Curitiba"),
  unit("b2", "branch", "sul", "Porto Alegre"),
  unit("b3", "branch", "norte", "Manaus"),
  unit("b4", "branch", "co", "Direta"),
];
const ALL: UnitScope = { kind: "all" };
const only = (...ids: string[]): UnitScope => ({ kind: "units", unitIds: new Set(ids) });
const read = (unitId: string, value: string | null, currency = "BRL") => ({ unitId, value, currency });

describe("decimais exatos", () => {
  it("compara e calcula porcentagem sem ponto flutuante", () => {
    expect(compareDecimals(parseDecimal("10.50")!, parseDecimal("10.5")!)).toBe(0);
    expect(compareDecimals(parseDecimal("-1")!, parseDecimal("0.1")!)).toBe(-1);
    expect(percentOfTotal(parseDecimal("1")!, parseDecimal("3")!)).toBe("33.3");
    expect(percentOfTotal(parseDecimal("2")!, parseDecimal("3")!)).toBe("66.7");
    expect(percentOfTotal(parseDecimal("1")!, parseDecimal("0")!)).toBeNull();
  });
});

describe("recorte de filiais e filtro por região", () => {
  it("sem região: todas as filiais do escopo, em ordem de nome; regiões e matriz ficam de fora", () => {
    expect(selectBranches(UNITS, ALL, null).map((u) => u.id)).toEqual(["b1", "b4", "b3", "b2"]);
  });
  it("com região: só as filiais abaixo dela, em qualquer profundidade", () => {
    expect(selectBranches(UNITS, ALL, "sul").map((u) => u.id)).toEqual(["b1", "b2"]);
    const deep = [...UNITS, unit("rs", "region", "sul", "RS"), unit("b5", "branch", "rs", "Pelotas")];
    expect(selectBranches(deep, ALL, "sul").map((u) => u.id)).toEqual(["b1", "b5", "b2"]);
  });
  it("escopo restrito não enxerga filiais de fora, nem pela região", () => {
    const scope = only("b1", "b2", "sul");
    expect(selectBranches(UNITS, scope, null).map((u) => u.id)).toEqual(["b1", "b2"]);
    expect(selectableRegions(UNITS, scope).map((u) => u.id)).toEqual(["sul"]);
  });
  it("região fora do escopo, inexistente ou filial usada como região respondem o mesmo erro", () => {
    expect(() => selectBranches(UNITS, only("b1"), "norte")).toThrow(RegionOutOfScopeError);
    expect(() => selectBranches(UNITS, ALL, "nao-existe")).toThrow(RegionOutOfScopeError);
    expect(() => selectBranches(UNITS, ALL, "b1")).toThrow(RegionOutOfScopeError);
  });
});

describe("consolidação e ranking", () => {
  const branches = selectBranches(UNITS, ALL, null);

  it("soma exata, ranking decrescente e participação", () => {
    const result = compareBranches(branches, [read("b1", "100.10"), read("b2", "300.20"), read("b3", "50"), read("b4", "49.70")], null);
    expect(result.total).toEqual({ status: "available", value: "500", currency: "BRL", reporting: 4, expected: 4, partial: false });
    expect(result.branches.map((b) => [b.name, b.rank])).toEqual([["Porto Alegre", 1], ["Curitiba", 2], ["Manaus", 3], ["Direta", 4]]);
    expect(result.branches[0]?.sharePercent).toBe("60"); // texto decimal normalizado (sem zeros finais); a tela formata com Intl
  });

  it("empate divide a posição e a seguinte pula", () => {
    const result = compareBranches(branches, [read("b1", "10"), read("b2", "10"), read("b3", "5"), read("b4", "1")], null);
    expect(result.branches.map((b) => b.rank)).toEqual([1, 1, 3, 4]);
  });

  it("indisponível nunca vira zero: fica fora da soma, sem posição e sem participação", () => {
    const result = compareBranches(branches, [read("b1", "100"), read("b2", null), read("b3", "50")], null);
    expect(result.total).toEqual({ status: "available", value: "150", currency: "BRL", reporting: 2, expected: 4, partial: true });
    const gone = result.branches.filter((b) => b.value === null);
    expect(gone.map((b) => b.name)).toEqual(["Direta", "Porto Alegre"]);
    expect(gone.every((b) => b.rank === null && b.sharePercent === null)).toBe(true);
    // Um zero verdadeiro é valor: entra, tem posição.
    const withZero = compareBranches(branches, [read("b1", "0"), read("b3", "5")], null);
    expect(withZero.branches.find((b) => b.name === "Curitiba")).toMatchObject({ value: "0", rank: 2 });
  });

  it("sem nenhum dado, o total é indisponível (não zero)", () => {
    expect(compareBranches(branches, [], null).total).toEqual({ status: "unavailable", reason: "no_data", reporting: 0, expected: 4 });
    expect(compareBranches([], [], null).total).toEqual({ status: "unavailable", reason: "no_branches", reporting: 0, expected: 0 });
  });

  it("moedas diferentes: sem soma, sem ranking, valores preservados", () => {
    const result = compareBranches(branches, [read("b1", "100", "BRL"), read("b2", "90", "USD"), read("b3", "5", "BRL")], null);
    expect(result.total).toEqual({ status: "unavailable", reason: "mixed_currency", reporting: 3, expected: 4 });
    expect(result.rankingSuspended).toBe(true);
    expect(result.branches.every((b) => b.rank === null && b.sharePercent === null)).toBe(true);
    expect(result.branches.find((b) => b.name === "Porto Alegre")).toMatchObject({ value: "90", currency: "USD" });
  });

  it("leitura de unidade fora do recorte é ignorada (região/matriz não contam duas vezes)", () => {
    const result = compareBranches(branches, [read("b1", "10"), read("sul", "999"), read("co", "999")], null);
    expect(result.total).toMatchObject({ status: "available", value: "10", reporting: 1 });
  });

  it("contagens sem moeda consolidam normalmente", () => {
    const result = compareBranches(branches, [{ unitId: "b1", value: "3" }, { unitId: "b2", value: "4" }], null);
    expect(result.total).toEqual({ status: "available", value: "7", reporting: 2, expected: 4, partial: true });
  });
});
