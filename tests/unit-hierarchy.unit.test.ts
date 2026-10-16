import { describe, expect, it } from "vitest";
import {
  assertUnitAccess, canAccessUnit, descendantsOf, resolveUnitScope, validateUnitChange,
  MAX_UNIT_DEPTH, UnitAccessDeniedError, type OrgUnit, type UnitGrant,
} from "@/domain/organization/unit-hierarchy";

const T = "empresa-a";
const u = (id: string, kind: OrgUnit["kind"], parentId: string | null, extra: Partial<OrgUnit> = {}): OrgUnit =>
  ({ id, tenantId: T, parentId, kind, name: id, ...extra });

// matriz SP > região Sul > filial Curitiba, filial Porto Alegre; matriz > filial SP
const tree: OrgUnit[] = [
  u("hq", "company", null), u("sul", "region", "hq"), u("cwb", "branch", "sul"), u("poa", "branch", "sul"), u("sp", "branch", "hq"),
];
const grant = (userId: string, unitId: string, tenantId = T): UnitGrant => ({ tenantId, userId, unitId });

describe("validacao da arvore de unidades", () => {
  it("aceita regiao, filial e campos de pais, fuso e moeda validos", () => {
    expect(validateUnitChange(tree, u("mg", "region", "hq", { countryCode: "BR", timezone: "America/Sao_Paulo", currency: "BRL" })).ok).toBe(true);
  });
  it("so uma matriz por empresa e a matriz nao tem pai", () => {
    const r = validateUnitChange(tree, u("hq2", "company", null));
    expect(!r.ok && r.errors).toContain("unit.only_one_company_per_tenant");
    expect(validateUnitChange([], u("hq", "company", "x")).ok).toBe(false);
  });
  it("filial nao pode ter filhos e pai precisa existir na mesma empresa", () => {
    const a = validateUnitChange(tree, u("x", "branch", "cwb"));
    expect(!a.ok && a.errors).toContain("unit.branch_cannot_have_children");
    const b = validateUnitChange(tree, u("x", "branch", "fantasma"));
    expect(!b.ok && b.errors).toContain("unit.parent_not_found_in_tenant");
  });
  it("recusa arvore misturando empresas", () => {
    const other: OrgUnit = { ...u("o", "branch", "hq"), tenantId: "empresa-b" };
    const r = validateUnitChange([...tree, other], u("novo", "branch", "hq"));
    expect(!r.ok && r.errors).toContain("unit.tree_mixes_tenants");
  });
  it("recusa ciclo ao mover uma regiao para dentro de si mesma", () => {
    const r = validateUnitChange(tree, u("sul", "region", "cwb"));
    expect(r.ok).toBe(false);
    const self = validateUnitChange(tree, u("sul", "region", "sul"));
    expect(!self.ok && self.errors).toContain("unit.cannot_be_own_parent");
  });
  it("recusa profundidade acima do limite", () => {
    let chain: OrgUnit[] = [u("hq", "company", null)];
    for (let i = 1; i < MAX_UNIT_DEPTH; i++) chain = [...chain, u(`r${i}`, "region", i === 1 ? "hq" : `r${i - 1}`)];
    const r = validateUnitChange(chain, u("extra", "region", `r${MAX_UNIT_DEPTH - 1}`));
    expect(!r.ok && r.errors).toContain("unit.max_depth_exceeded");
  });
  it("ao mover uma regiao, conta tambem a profundidade dos descendentes", () => {
    let chain: OrgUnit[] = [u("hq", "company", null), u("a", "region", "hq"), u("b", "region", "a")];
    for (let i = 1; i <= MAX_UNIT_DEPTH - 4; i++) chain = [...chain, u(`s${i}`, "region", i === 1 ? "b" : `s${i - 1}`)];
    const deepest = chain[chain.length - 1];
    chain = [...chain, u("leaf", "branch", deepest.id)]; // profundidade total = MAX_UNIT_DEPTH - 1 + 1
    // mover "b" (com a subarvore) para baixo de outra regiao funda estoura o limite
    const withOther = [...chain, u("c", "region", "hq"), u("c2", "region", "c"), u("c3", "region", "c2")];
    const r = validateUnitChange(withOther, u("b", "region", "c3"));
    expect(!r.ok && r.errors).toContain("unit.max_depth_exceeded");
  });
  it("recusa pais, fuso ou moeda invalidos", () => {
    const r = validateUnitChange(tree, u("x", "branch", "hq", { countryCode: "br", timezone: "Marte/Olimpo", currency: "ZZZ" }));
    expect(!r.ok && r.errors).toEqual(expect.arrayContaining([
      "unit.country_must_be_iso_3166_alpha2", "unit.timezone_must_be_iana", "unit.currency_must_be_iso_4217"]));
  });
});

describe("escopo de unidades por pessoa", () => {
  const scope = (role: Parameters<typeof resolveUnitScope>[0]["role"], grants: UnitGrant[], units = tree, userId = "ana") =>
    resolveUnitScope({ tenantId: T, userId, role, units, grants });

  it("empresa sem unidades fica sem restricao (compatibilidade com a V1)", () => {
    expect(scope("viewer", [], [])).toEqual({ kind: "all" });
  });
  it("dono e administrador veem tudo", () => {
    expect(scope("owner", []).kind).toBe("all");
    expect(scope("admin", []).kind).toBe("all");
  });
  it("sem concessao, analista e leitor nao veem nada, nem dado da empresa", () => {
    const s = scope("analyst", []);
    expect(s).toEqual({ kind: "units", unitIds: new Set() });
    expect(canAccessUnit(s, "sp")).toBe(false);
    expect(canAccessUnit(s, null)).toBe(false);
  });
  it("gerente de filial ve so a sua", () => {
    const s = scope("member", [grant("ana", "cwb")]);
    expect(canAccessUnit(s, "cwb")).toBe(true);
    expect(canAccessUnit(s, "poa")).toBe(false);
    expect(canAccessUnit(s, "sp")).toBe(false);
    expect(canAccessUnit(s, null)).toBe(false);
  });
  it("concessao em regiao inclui as filiais abaixo", () => {
    const s = scope("viewer", [grant("ana", "sul")]);
    expect([...["sul", "cwb", "poa"]].every((id) => canAccessUnit(s, id))).toBe(true);
    expect(canAccessUnit(s, "sp")).toBe(false);
    expect(canAccessUnit(s, "hq")).toBe(false);
  });
  it("concessao na matriz equivale a todas", () => {
    expect(scope("viewer", [grant("ana", "hq")]).kind).toBe("all");
  });
  it("ignora concessao de outra pessoa, de outra empresa ou de unidade inexistente", () => {
    const s = scope("viewer", [grant("bia", "sp"), grant("ana", "sp", "empresa-b"), grant("ana", "fantasma")]);
    expect(s).toEqual({ kind: "units", unitIds: new Set() });
  });
  it("ignora unidades de outra empresa na lista", () => {
    const foreign: OrgUnit = { ...u("sp", "branch", "hq"), tenantId: "empresa-b" };
    expect(scope("viewer", [grant("ana", "sp")], [foreign])).toEqual({ kind: "all" });
  });
  it("assertUnitAccess lanca erro de unidade negada", () => {
    const s = scope("viewer", [grant("ana", "cwb")]);
    expect(() => assertUnitAccess(s, "poa")).toThrow(UnitAccessDeniedError);
    expect(() => assertUnitAccess(s, "cwb")).not.toThrow();
  });
  it("descendantsOf nao entra em loop com dado corrompido", () => {
    const loop = [u("a", "region", "b"), u("b", "region", "a")];
    expect(descendantsOf(loop, "a")).toEqual(new Set(["a", "b"]));
  });
});
