import { isCurrencyCode } from "@/domain/core/money";
import { fail, ok, type Validation } from "@/domain/core/result";
import type { FmccRole } from "@/domain/security/permissions";
import { PermissionDeniedError } from "@/domain/security/tenant-context";

/**
 * Hierarquia de unidades dentro de uma empresa cliente (ADR-019):
 * empresa (matriz) > regiões (qualquer profundidade) > filiais.
 * Regras puras, sem banco. O banco repete as regras que protegem o isolamento.
 */
export type UnitKind = "company" | "region" | "branch";

export interface OrgUnit {
  readonly id: string;
  readonly tenantId: string;
  readonly parentId: string | null;
  readonly kind: UnitKind;
  readonly name: string;
  /** País (ISO 3166-1 alfa-2), fuso (IANA) e moeda (ISO 4217) da unidade, quando diferem da empresa. */
  readonly countryCode?: string;
  readonly timezone?: string;
  readonly currency?: string;
}

export interface UnitGrant {
  readonly tenantId: string;
  readonly userId: string;
  readonly unitId: string;
}

export const MAX_UNIT_DEPTH = 8;

/** E uma negacao de permissao: toda rota que ja responde 403 para PermissionDeniedError responde o mesmo aqui. */
export class UnitAccessDeniedError extends PermissionDeniedError {
  constructor() { super("metric:read"); this.message = "security.unit_access_denied"; }
}

function validTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

function subtreeHeight(rootId: string, units: readonly OrgUnit[]): number {
  const children = new Map<string, string[]>();
  for (const u of units) if (u.parentId !== null) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u.id]);
  const walk = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return 1 + Math.max(0, ...(children.get(id) ?? []).map((c) => walk(c, seen)));
  };
  return walk(rootId, new Set());
}

function depthOf(unit: OrgUnit, byId: ReadonlyMap<string, OrgUnit>): number {
  let depth = 1;
  let current = unit;
  const seen = new Set<string>([unit.id]);
  while (current.parentId !== null) {
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) return Number.POSITIVE_INFINITY;
    seen.add(parent.id);
    current = parent;
    depth += 1;
  }
  return depth;
}

/** Valida uma unidade nova (ou movida) contra a árvore existente da mesma empresa. */
export function validateUnitChange(existing: readonly OrgUnit[], candidate: OrgUnit): Validation<OrgUnit> {
  const errors: string[] = [];
  if (!candidate.id.trim()) errors.push("unit.id_required");
  if (!candidate.tenantId.trim()) errors.push("unit.tenant_required");
  if (!candidate.name.trim()) errors.push("unit.name_required");
  if (candidate.countryCode !== undefined && !/^[A-Z]{2}$/.test(candidate.countryCode)) errors.push("unit.country_must_be_iso_3166_alpha2");
  if (candidate.timezone !== undefined && !validTimezone(candidate.timezone)) errors.push("unit.timezone_must_be_iana");
  if (candidate.currency !== undefined && !isCurrencyCode(candidate.currency)) errors.push("unit.currency_must_be_iso_4217");
  if (existing.some((u) => u.tenantId !== candidate.tenantId)) errors.push("unit.tree_mixes_tenants");

  const others = existing.filter((u) => u.id !== candidate.id);
  const byId = new Map(others.map((u) => [u.id, u]));

  if (candidate.kind === "company") {
    if (candidate.parentId !== null) errors.push("unit.company_has_no_parent");
    if (others.some((u) => u.kind === "company")) errors.push("unit.only_one_company_per_tenant");
  } else {
    if (candidate.parentId === null) errors.push("unit.parent_required");
    else if (candidate.parentId === candidate.id) errors.push("unit.cannot_be_own_parent");
    else {
      const parent = byId.get(candidate.parentId);
      if (!parent) errors.push("unit.parent_not_found_in_tenant");
      else {
        if (parent.kind === "branch") errors.push("unit.branch_cannot_have_children");
        // Evita ciclo: o pai não pode ser descendente da própria unidade.
        const withCandidate = new Map(byId).set(candidate.id, candidate);
        if (depthOf(candidate, withCandidate) === Number.POSITIVE_INFINITY) errors.push("unit.cycle_detected");
        else if (depthOf(candidate, withCandidate) + subtreeHeight(candidate.id, [...others, candidate]) - 1 > MAX_UNIT_DEPTH)
          errors.push("unit.max_depth_exceeded");
      }
    }
  }
  return errors.length > 0 ? fail(...errors) : ok(candidate);
}

export type UnitScope =
  | { readonly kind: "all" }
  | { readonly kind: "units"; readonly unitIds: ReadonlySet<string> };

/** Unidades abaixo de uma unidade, incluindo ela mesma. */
export function descendantsOf(units: readonly OrgUnit[], rootId: string): ReadonlySet<string> {
  const children = new Map<string, string[]>();
  for (const u of units) {
    if (u.parentId !== null) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u.id]);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/**
 * Escopo de unidades que uma pessoa enxerga.
 * - Empresa sem árvore de unidades: sem restrição (comportamento da V1).
 * - Dono e administrador: todas as unidades.
 * - Demais papéis: só as unidades concedidas e suas descendentes; sem concessão, nada.
 * - Concessão na matriz equivale a todas.
 * Concessões de outra empresa ou de outra pessoa são ignoradas.
 */
export function resolveUnitScope(input: {
  tenantId: string;
  userId: string;
  role: FmccRole;
  units: readonly OrgUnit[];
  grants: readonly UnitGrant[];
}): UnitScope {
  const units = input.units.filter((u) => u.tenantId === input.tenantId);
  if (units.length === 0) return { kind: "all" };
  if (input.role === "owner" || input.role === "admin") return { kind: "all" };

  const company = units.find((u) => u.kind === "company");
  const ids = new Set<string>();
  for (const g of input.grants) {
    if (g.tenantId !== input.tenantId || g.userId !== input.userId) continue;
    if (!units.some((u) => u.id === g.unitId)) continue;
    if (company && g.unitId === company.id) return { kind: "all" };
    for (const id of descendantsOf(units, g.unitId)) ids.add(id);
  }
  return { kind: "units", unitIds: ids };
}

/** `unitId` nulo é dado no nível da empresa: só quem enxerga tudo vê. */
export function canAccessUnit(scope: UnitScope, unitId: string | null): boolean {
  if (scope.kind === "all") return true;
  return unitId !== null && scope.unitIds.has(unitId);
}

export function assertUnitAccess(scope: UnitScope, unitId: string | null): void {
  if (!canAccessUnit(scope, unitId)) throw new UnitAccessDeniedError();
}
