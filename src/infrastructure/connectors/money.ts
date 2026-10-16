/** Valor decimal da origem -> menor unidade (centavos), sem acumular erro de ponto flutuante. */
export function toMinorUnits(value: unknown): number | undefined {
  let n = NaN;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^-?\d+([.,]\d+)?$/.test(value.trim())) n = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  const minor = Math.round(n * 100);
  return Number.isSafeInteger(minor) ? minor : undefined;
}
