/** Linha de um relatório: o valor vem do serviço de métricas, nunca é calculado aqui. Sem valor = indisponível, jamais zero. */
export interface ReportRow {
  readonly metricId: string;
  readonly name: string;
  readonly value: string | null;
  readonly unit: string;
  readonly currency: string | null;
  readonly freshness: string;
  readonly quality: string;
  readonly computedAt: Date | null;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Célula de CSV segura: aspas, e texto que o Excel leria como fórmula ganha apóstrofo na frente. */
export function csvCell(raw: string | null): string {
  const text = raw ?? "";
  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export const CSV_HEADER = ["metric_id", "metric", "status", "value", "unit", "currency", "freshness", "quality", "computed_at"] as const;

export function toCsv(rows: readonly ReportRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push([
      r.metricId, r.name, r.value === null ? "unavailable" : "available", r.value, r.unit, r.currency, r.freshness, r.quality,
      r.computedAt ? r.computedAt.toISOString() : null,
    ].map(csvCell).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`; // BOM para o Excel abrir acentos
}
