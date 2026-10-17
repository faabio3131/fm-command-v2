import type { ConsolidationUnavailableReason, RankedBranch, UnitComparison } from "@/domain/metrics/unit-comparison";

/**
 * Destaques de um ranking de filiais para responder "qual vendeu mais, a segunda, a terceira, a pior".
 * Regra pura sobre o resultado do motor: não calcula valor nenhum, só escolhe quem está em cada posição.
 *  - Empates dividem a posição (1, 1, 3): a segunda posição não existe quando duas filiais empatam em primeiro.
 *  - "Menor valor" é o menor número, não o "pior" de negócio: em custo ou falha o maior é que preocupa
 *    (a polaridade vai junto no fato para quem escreve a resposta).
 *  - Filial sem valor não ganha posição nem vira zero: aparece só em `withoutValue`.
 *  - Moedas diferentes suspendem o ranking (ADR-012), então não há destaque nenhum.
 */
export interface HighlightBranch {
  readonly unitId: string;
  readonly name: string;
  readonly value: string;
  readonly currency?: string;
  readonly sharePercent: string | null;
}

export interface RankingPosition {
  readonly position: 1 | 2 | 3;
  readonly branches: readonly HighlightBranch[];
}

export type RankingHighlights =
  | {
      readonly status: "available";
      /** Posições 1 a 3 que existem (com empate, uma posição pode faltar). */
      readonly positions: readonly RankingPosition[];
      /** Filiais com o menor valor; nulo com menos de duas filiais com valor (não há comparação). */
      readonly lowest: readonly HighlightBranch[] | null;
      readonly reporting: number;
      readonly expected: number;
      readonly partial: boolean;
      /** Nomes das filiais sem valor no período (indisponível, nunca zero). */
      readonly withoutValue: readonly string[];
    }
  | { readonly status: "unavailable"; readonly reason: ConsolidationUnavailableReason; readonly reporting: number; readonly expected: number };

function toHighlight(branch: RankedBranch): HighlightBranch {
  return {
    unitId: branch.unitId, name: branch.name, value: branch.value as string,
    ...(branch.currency ? { currency: branch.currency } : {}),
    sharePercent: branch.sharePercent,
  };
}

export function rankingHighlights(comparison: UnitComparison): RankingHighlights {
  const { total } = comparison;
  if (total.status === "unavailable") return { status: "unavailable", reason: total.reason, reporting: total.reporting, expected: total.expected };

  const ranked = comparison.branches.filter((b): b is RankedBranch & { value: string; rank: number } => b.value !== null && b.rank !== null);
  if (ranked.length === 0) return { status: "unavailable", reason: "no_data", reporting: total.reporting, expected: total.expected };

  const positions = ([1, 2, 3] as const)
    .map((position) => ({ position, branches: ranked.filter((b) => b.rank === position).map(toHighlight) }))
    .filter((p) => p.branches.length > 0);

  // O motor ordena do maior para o menor, então o menor valor é o do fim da lista.
  const lastRank = Math.max(...ranked.map((b) => b.rank));
  const lowest = ranked.length >= 2 ? ranked.filter((b) => b.rank === lastRank).map(toHighlight) : null;
  // Se todas empatam em primeiro, não há "menor" distinto do maior.
  const allTied = lowest !== null && lastRank === 1;

  return {
    status: "available",
    positions,
    lowest: allTied ? null : lowest,
    reporting: total.reporting,
    expected: total.expected,
    partial: total.partial,
    withoutValue: comparison.branches.filter((b) => b.value === null).map((b) => b.name),
  };
}
