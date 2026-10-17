import { localParts, zonedToUtc } from "@/domain/reports/schedule";

/**
 * Janelas de mês para a série histórica (etapa 9G). Calendário e fuso da empresa, do mais antigo para o mês corrente.
 * O mês corrente vai do dia 1 até agora; os anteriores são meses fechados. O fim de um mês fechado é 1 ms antes do início do
 * seguinte, porque a consulta de fatos inclui o instante final e um fato exatamente na virada não pode contar em dois meses.
 */
export interface MonthWindow {
  /** AAAA-MM no fuso da empresa. */
  readonly key: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly closed: boolean;
}

export const MAX_SERIES_MONTHS = 24;

export function monthWindows(now: Date, timeZone: string, count: number): readonly MonthWindow[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_SERIES_MONTHS) throw new Error("metrics.series_months_invalid");
  const local = localParts(now, timeZone);
  const startOf = (offset: number) => {
    const idx = local.y * 12 + (local.m - 1) + offset;
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
  };
  const out: MonthWindow[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const cur = startOf(-back);
    const next = startOf(-back + 1);
    const periodStart = zonedToUtc(cur.y, cur.m, 1, 0, timeZone);
    const key = `${cur.y}-${String(cur.m).padStart(2, "0")}`;
    out.push(back === 0
      ? { key, periodStart, periodEnd: now, closed: false }
      : { key, periodStart, periodEnd: new Date(zonedToUtc(next.y, next.m, 1, 0, timeZone).getTime() - 1), closed: true });
  }
  return out;
}
