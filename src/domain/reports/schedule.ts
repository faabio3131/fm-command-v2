/**
 * Agenda de relatório. Tudo é calculado no fuso da empresa e só com aritmética de calendário, para que "toda segunda às 8h"
 * continue sendo 8h locais na mudança de horário. A chave do período é a data local da ocorrência: é ela que impede enviar duas vezes.
 */
export const REPORT_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

export interface ReportSchedule {
  readonly frequency: ReportFrequency;
  /** Hora local, 0–23. */
  readonly hour: number;
  /** 0 = domingo … 6 = sábado (semanal). */
  readonly weekday: number;
  /** 1–28 (mensal); limitado a 28 para existir em todo mês. */
  readonly dayOfMonth: number;
}

/** Quanto tempo depois da hora marcada o envio ainda vale. Depois disso (ex.: sistema parado), espera a próxima ocorrência. */
export const GRACE_MS = 36 * 3_600_000;

export function isFrequency(value: unknown): value is ReportFrequency {
  return typeof value === "string" && (REPORT_FREQUENCIES as readonly string[]).includes(value);
}

export function validateSchedule(input: { frequency: unknown; hour: unknown; weekday: unknown; dayOfMonth: unknown }): ReportSchedule | null {
  const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
  const hour = int(input.hour, 0, 23);
  const weekday = int(input.weekday, 0, 6);
  const dayOfMonth = int(input.dayOfMonth, 1, 28);
  if (!isFrequency(input.frequency) || hour === null || weekday === null || dayOfMonth === null) return null;
  return { frequency: input.frequency, hour, weekday, dayOfMonth };
}

interface LocalParts { y: number; m: number; d: number; h: number; min: number }

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/** Instante UTC em que o relógio local do fuso marca y-m-d h:00. */
export function zonedToUtc(y: number, m: number, d: number, h: number, timeZone: string): Date {
  const wall = Date.UTC(y, m - 1, d, h);
  const offsetAt = (instant: number) => {
    const p = localParts(new Date(instant), timeZone);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(instant / 60_000) * 60_000;
  };
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess); // segunda passada: o deslocamento pode mudar entre o chute e o instante certo
  return new Date(guess);
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export interface Occurrence {
  readonly at: Date;
  readonly key: string;
}

/** Ocorrência mais recente da agenda que já passou (até 62 dias atrás). */
export function latestOccurrence(schedule: ReportSchedule, now: Date, timeZone: string): Occurrence | null {
  const today = localParts(now, timeZone);
  for (let back = 0; back <= 62; back += 1) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d - back));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const matches = schedule.frequency === "daily" || (schedule.frequency === "weekly" ? day.getUTCDay() === schedule.weekday : d === schedule.dayOfMonth);
    if (!matches) continue;
    const at = zonedToUtc(y, m, d, schedule.hour, timeZone);
    if (at.getTime() <= now.getTime()) return { at, key: dateKey(y, m, d) };
  }
  return null;
}

/** A ocorrência a enviar agora, ou nulo: nada novo desde a última, ou já passou do prazo de tolerância. */
/** `notBefore`: nunca envia ocorrência anterior à criação do relatório (um relatório novo não dispara o "de ontem"). */
export function dueOccurrence(schedule: ReportSchedule, now: Date, timeZone: string, lastKey: string | null, notBefore?: Date): Occurrence | null {
  const latest = latestOccurrence(schedule, now, timeZone);
  if (!latest) return null;
  if (notBefore && latest.at.getTime() < notBefore.getTime()) return null;
  if (lastKey !== null && latest.key <= lastKey) return null;
  if (now.getTime() - latest.at.getTime() > GRACE_MS) return null;
  return latest;
}
