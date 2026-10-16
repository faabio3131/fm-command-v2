import { compareDecimals, parseDecimal, percentOfTotal, sumDecimals, type DecimalValue } from "@/domain/core/decimal";
import { canAccessUnit, descendantsOf, type OrgUnit, type UnitScope } from "@/domain/organization/unit-hierarchy";

/**
 * Consolidação, ranking e filtro por região entre filiais (etapa 9B).
 * Regras puras. Duas garantias:
 *  - "Indisponível" nunca vira zero: filial sem valor não entra na soma, não ganha posição e aparece como indisponível.
 *  - Sem conversão de moeda: filiais em moedas diferentes não são somadas nem ordenadas (ADR-012).
 * A consolidação soma só filiais (as folhas da árvore), para não contar duas vezes o que uma região ou a matriz também guarde.
 */
export interface UnitReading {
  readonly unitId: string;
  /** Valor do motor de métricas; nulo = indisponível. */
  readonly value: string | null;
  readonly currency?: string;
}

export type ConsolidationUnavailableReason = "no_branches" | "no_data" | "mixed_currency";

export type ConsolidatedTotal =
  | {
      readonly status: "available";
      readonly value: string;
      readonly currency?: string;
      /** Filiais com valor / filiais no recorte. `partial` quando falta alguma. */
      readonly reporting: number;
      readonly expected: number;
      readonly partial: boolean;
    }
  | { readonly status: "unavailable"; readonly reason: ConsolidationUnavailableReason; readonly reporting: number; readonly expected: number };

export interface RankedBranch {
  readonly unitId: string;
  readonly name: string;
  readonly value: string | null;
  readonly currency?: string;
  /** Posição (1 = maior). Empates dividem a posição. Nulo quando indisponível ou quando a moeda impede comparar. */
  readonly rank: number | null;
  /** Participação no total, em % com uma casa. Nulo quando não há total comparável. */
  readonly sharePercent: string | null;
}

export interface UnitComparison {
  readonly regionId: string | null;
  readonly total: ConsolidatedTotal;
  readonly branches: readonly RankedBranch[];
  /** Verdadeiro quando o ranking foi suspenso por moedas diferentes. */
  readonly rankingSuspended: boolean;
}

export class RegionOutOfScopeError extends Error {
  constructor() { super("metrics.region_not_available"); }
}

/** Filiais do recorte: dentro da região escolhida (ou todas) e dentro do escopo da pessoa. */
export function selectBranches(units: readonly OrgUnit[], scope: UnitScope, regionId: string | null): readonly OrgUnit[] {
  let allowed: ReadonlySet<string> | null = null;
  if (regionId !== null) {
    const region = units.find((u) => u.id === regionId);
    // Região desconhecida ou fora do escopo responde igual: não revela que existe.
    if (!region || region.kind === "branch" || !canAccessUnit(scope, region.id)) throw new RegionOutOfScopeError();
    allowed = descendantsOf(units, region.id);
  }
  return units
    .filter((u) => u.kind === "branch" && (allowed === null || allowed.has(u.id)) && canAccessUnit(scope, u.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Regiões que a pessoa pode escolher como filtro. */
export function selectableRegions(units: readonly OrgUnit[], scope: UnitScope): readonly OrgUnit[] {
  return units.filter((u) => u.kind === "region" && canAccessUnit(scope, u.id)).sort((a, b) => a.name.localeCompare(b.name));
}

export function compareBranches(branches: readonly OrgUnit[], readings: readonly UnitReading[], regionId: string | null): UnitComparison {
  const byUnit = new Map(readings.map((reading) => [reading.unitId, reading]));
  const parsed = branches.map((branch) => {
    const reading = byUnit.get(branch.id);
    const value = reading?.value != null ? parseDecimal(reading.value) : null;
    return { branch, reading, value };
  });
  const reporting = parsed.filter((row): row is typeof row & { value: DecimalValue } => row.value !== null);
  const expected = branches.length;

  const currencies = new Set(reporting.map((row) => row.reading?.currency ?? ""));
  const mixed = currencies.size > 1;

  let total: ConsolidatedTotal;
  if (expected === 0) total = { status: "unavailable", reason: "no_branches", reporting: 0, expected: 0 };
  else if (reporting.length === 0) total = { status: "unavailable", reason: "no_data", reporting: 0, expected };
  else if (mixed) total = { status: "unavailable", reason: "mixed_currency", reporting: reporting.length, expected };
  else {
    const currency = [...currencies][0] || undefined;
    total = {
      status: "available", value: sumDecimals(reporting.map((row) => row.value)), ...(currency ? { currency } : {}),
      reporting: reporting.length, expected, partial: reporting.length < expected,
    };
  }

  const totalValue = total.status === "available" ? parseDecimal(total.value) : null;
  const sorted = [...reporting].sort((a, b) => compareDecimals(b.value, a.value) || a.branch.name.localeCompare(b.branch.name));
  const rankOf = new Map<string, number>();
  if (!mixed) {
    sorted.forEach((row, index) => {
      const previous = sorted[index - 1];
      const tie = previous && compareDecimals(previous.value, row.value) === 0;
      rankOf.set(row.branch.id, tie ? (rankOf.get(previous.branch.id) as number) : index + 1);
    });
  }

  const ordered = [...sorted, ...parsed.filter((row) => row.value === null).sort((a, b) => a.branch.name.localeCompare(b.branch.name))];
  return {
    regionId, total, rankingSuspended: mixed,
    branches: ordered.map((row) => ({
      unitId: row.branch.id, name: row.branch.name,
      value: row.value === null ? null : (row.reading?.value as string),
      ...(row.reading?.currency ? { currency: row.reading.currency } : {}),
      rank: rankOf.get(row.branch.id) ?? null,
      sharePercent: row.value !== null && totalValue && !mixed ? percentOfTotal(row.value, totalValue) : null,
    })),
  };
}
