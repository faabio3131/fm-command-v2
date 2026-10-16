import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("F12 financial UI", () => {
  it("expõe indisponibilidade e semântica pendente sem fabricar valores", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/dashboard/finance/page.tsx"), "utf8");
    expect(source).toContain("Ausência de fonte permanece indisponível");
    expect(source).toContain("Fonte ainda não conectada");
    expect(source).toContain("Semântica pendente");
    expect(source).not.toContain("Math.random");
  });
});
