/** Casas decimais da moeda (ISO 4217). Moeda fora da lista usa 2. */
const ZERO = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "PYG", "XOF", "XAF"]);
const THREE = new Set(["KWD", "BHD", "OMR", "JOD", "TND", "LYD", "IQD"]);

export function currencyExponent(currency: string | undefined): number {
  const c = (currency ?? "").toUpperCase();
  return ZERO.has(c) ? 0 : THREE.has(c) ? 3 : 2;
}

/**
 * Valor decimal da origem -> menor unidade da moeda, sem erro de ponto flutuante.
 * Mais casas decimais do que a moeda comporta = ausente (nunca arredondado em silêncio).
 * "1,234" é lido como decimal (vírgula); a origem deve enviar sem separador de milhar.
 */
export function toMinorUnits(value: unknown, currency?: string): number | undefined {
  const exp = currencyExponent(currency);
  let text: string | undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    // Número JSON: absorve só o ruído de ponto flutuante (0.1+0.2); casas a mais de verdade = ausente.
    const scaled = value * 10 ** exp;
    const minor = Math.round(scaled);
    if (Math.abs(scaled - minor) > 1e-6 * Math.max(1, Math.abs(scaled))) return undefined;
    return Number.isSafeInteger(minor) ? minor + 0 : undefined;
  } else if (typeof value === "string") text = value.trim();
  if (text === undefined || !/^-?\d+([.,]\d+)?$/.test(text)) return undefined;
  const [int, frac = ""] = text.replace(",", ".").split(".");
  if (frac.length > exp && /[1-9]/.test(frac.slice(exp))) return undefined;
  const minor = Number(int + frac.slice(0, exp).padEnd(exp, "0"));
  return Number.isSafeInteger(minor) ? minor + 0 : undefined;
}
