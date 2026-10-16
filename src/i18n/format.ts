import type { Locale } from "./locales";

/** Formatação pela API Intl, no idioma da pessoa e no fuso da empresa (datas são guardadas em UTC). */
export function formatDateTime(date: Date | string, locale: Locale, timeZone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
}

export function formatDate(date: Date | string, locale: Locale, timeZone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(d);
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
