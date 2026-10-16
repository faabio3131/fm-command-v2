import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";

describe("F12 financial UI", () => {
  it("expõe indisponibilidade e semântica pendente sem fabricar valores", () => {
    const source = readUiSource("src/app/dashboard/finance/page.tsx");
    expect(source).toContain("Ausência de fonte permanece indisponível");
    expect(source).toContain("Fonte ainda não conectada");
    expect(source).toContain("Semântica pendente");
    expect(source).not.toContain("Math.random");
  });
});
