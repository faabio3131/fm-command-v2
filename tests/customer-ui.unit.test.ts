import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("F15 customer intelligence UI", () => {
  it("expõe somente agregados e não inventa score", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/dashboard/customers/page.tsx"), "utf8");
    expect(source).toContain("somente agregados governados");
    expect(source).toContain("Nenhum score de risco ou experiência é inventado");
    expect(source).toContain("Semântica pendente");
    expect(source).not.toContain("Math.random");
  });
});
