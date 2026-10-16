/**
 * Conta texto de interface escrito direto no componente (fora dos catálogos de tradução).
 * Heurística: texto entre tags JSX e textos em atributos de interface (aria-label, placeholder, title, alt)
 * e literais com acento ou com duas palavras. É uma catraca, não um juiz perfeito: serve para o número só poder cair.
 * Uso: npx tsx scripts/i18n/scan-hardcoded.ts --write   (regrava tests/fixtures/i18n-hardcoded-baseline.json)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src/app", "src/i18n/react"];
const ACCENT = /[áéíóúãõçâêôÁÉÍÓÚÃÕÇ]/;
const WORDS = /[A-Za-zÀ-ú]{3,}[ ][A-Za-zÀ-ú]{2,}/;
const NOT_TEXT = /[/=:{};<>]|^[a-z0-9_-]+( [a-z0-9_-]+)*$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
  });
}

function looksLikeUiText(t: string): boolean {
  const text = t.trim();
  if (text.length < 3) return false;
  if (ACCENT.test(text)) return true;
  return WORDS.test(text) && !NOT_TEXT.test(text);
}

export function countHardcoded(source: string): number {
  // Remove comentários de bloco e de linha para não contar documentação.
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  let n = 0;
  for (const m of clean.matchAll(/"([^"\n]{3,})"|>([^<>{}\n]{3,})</g)) {
    const text = m[1] ?? m[2];
    // Importações, nomes de classe e caminhos não são texto de interface.
    if (m[1] !== undefined && /^(?:\.{0,2}\/|@\/|next|react|node:)/.test(text)) continue;
    if (looksLikeUiText(text)) n += 1;
  }
  return n;
}

export function scanAll(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const n = countHardcoded(readFileSync(file, "utf8"));
      if (n > 0) out[relative(ROOT, file)] = n;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv.includes("--write")) {
  const result = scanAll();
  writeFileSync(join(ROOT, "tests/fixtures/i18n-hardcoded-baseline.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(`baseline gravado: ${Object.values(result).reduce((a, b) => a + b, 0)} textos em ${Object.keys(result).length} arquivos`);
}
