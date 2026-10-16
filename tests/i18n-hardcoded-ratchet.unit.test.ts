import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { countHardcoded, scanAll } from "../scripts/i18n/scan-hardcoded";

const baseline = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/i18n-hardcoded-baseline.json"), "utf8")) as Record<string, number>;

describe("texto de interface fora dos catalogos (catraca)", () => {
  it("o detector enxerga texto fixo em JSX e em atributos, e ignora codigo", () => {
    expect(countHardcoded('<p>Nenhuma notificação encontrada</p>')).toBe(1);
    expect(countHardcoded('<input placeholder="Seu nome completo" />')).toBe(1);
    expect(countHardcoded('<p>{t("auth.lead")}</p>')).toBe(0);
    expect(countHardcoded('import x from "@/infrastructure/auth/auth-client"; const a = "use client";')).toBe(0);
    expect(countHardcoded('<div className="command-nav-item active" /> // Texto em comentário com acentuação')).toBe(0);
  });

  it("nenhuma tela passa a ter MAIS texto fixo do que no registro, e tela nova nasce sem texto fixo", () => {
    const now = scanAll();
    const worse = Object.entries(now).filter(([file, n]) => n > (baseline[file] ?? 0)).map(([file, n]) => `${file}: ${n} (registro: ${baseline[file] ?? 0})`);
    expect(worse, "Texto novo de interface vai para src/i18n/messages (pt-BR e en-US), não direto no componente.").toEqual([]);
  });

  it("quando um texto sai do componente, o registro desce junto (a catraca trava o ganho)", () => {
    const now = scanAll();
    const stale = Object.entries(baseline).filter(([file, n]) => (now[file] ?? 0) < n).map(([file, n]) => `${file}: registro ${n}, agora ${now[file] ?? 0}`);
    expect(stale, "Rode: npx tsx scripts/i18n/scan-hardcoded.ts --write").toEqual([]);
  });
});
