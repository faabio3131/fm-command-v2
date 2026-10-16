import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";

describe("F15 customer intelligence UI", () => {
  it("expõe somente agregados e não inventa score", () => {
    const source = readUiSource("src/app/dashboard/customers/page.tsx");
    expect(source).toContain("somente agregados governados");
    expect(source).toContain("Nenhum score de risco ou experiência é inventado");
    expect(source).toContain("Semântica pendente");
    expect(source).not.toContain("Math.random");
  });
});
