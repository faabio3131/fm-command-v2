import { localParts, zonedToUtc } from "@/domain/reports/schedule";

/**
 * Períodos que o usuário escolhe nas telas. Sempre no calendário e no fuso da empresa.
 * - current: do dia 1 do mês até agora; previous: o mês anterior fechado;
 * - quarter: do início do trimestre até agora; year: de 1º de janeiro até agora.
 * Cada tipo é guardado à parte (coluna period_kind), porque meses, trimestres e anos podem começar no mesmo instante.
 */
export const PERIOD_KINDS = ["current", "previous", "quarter", "year"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const DEFAULT_PERIOD_KIND: PeriodKind = "current";

export function isPeriodKind(value: unknown): value is PeriodKind {
  return typeof value === "string" && (PERIOD_KINDS as readonly string[]).includes(value);
}
/** Valor vindo de URL ou corpo: o que não for reconhecido vira o padrão, nunca um erro nem outro período. */
export function parsePeriodKind(value: unknown): PeriodKind {
  return isPeriodKind(value) ? value : DEFAULT_PERIOD_KIND;
}

export interface ResolvedPeriod { readonly kind: PeriodKind; readonly periodStart: Date; readonly periodEnd: Date }

export function resolvePeriod(kind: PeriodKind, now: Date, timeZone: string): ResolvedPeriod {
  const local = localParts(now, timeZone);
  const at = (y: number, m: number) => {
    // Normaliza mês fora de 1..12 (janeiro - 1 = dezembro do ano anterior).
    const idx = y * 12 + (m - 1);
    return zonedToUtc(Math.floor(idx / 12), (idx % 12) + 1, 1, 0, timeZone);
  };
  switch (kind) {
    case "current": return { kind, periodStart: at(local.y, local.m), periodEnd: now };
    case "previous": return { kind, periodStart: at(local.y, local.m - 1), periodEnd: at(local.y, local.m) };
    case "quarter": return { kind, periodStart: at(local.y, Math.floor((local.m - 1) / 3) * 3 + 1), periodEnd: now };
    case "year": return { kind, periodStart: at(local.y, 1), periodEnd: now };
  }
}
