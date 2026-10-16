/** Casas decimais da moeda (ISO 4217). Moeda fora da lista usa 2. */
const ZERO = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "PYG", "XOF", "XAF"]);
const THREE = new Set(["KWD", "BHD", "OMR", "JOD", "TND", "LYD", "IQD"]);

export function currencyExponent(currency: string | undefined): number {
  const c = (currency ?? "").toUpperCase();
  return ZERO.has(c) ? 0 : THREE.has(c) ? 3 : 2;
}
