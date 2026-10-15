export type Validation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

export const ok = <T>(value: T): Validation<T> => ({ ok: true, value });
export const fail = (...errors: string[]): Validation<never> => ({ ok: false, errors });

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** ISO 8601 em UTC, sempre terminado em Z (ex.: 2026-10-15T20:41:00.000Z). */
export function isUtcIso(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
}

/** Etiqueta de idioma BCP 47 (ex.: pt-BR, en-US). */
export function isLocaleTag(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0) return false;
  try {
    return Intl.getCanonicalLocales(v).length === 1;
  } catch {
    return false;
  }
}
