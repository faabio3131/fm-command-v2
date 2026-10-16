import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";

describe("F13 growth UI", () => {
  it("expõe gaps comerciais sem fabricar atribuição", () => {
    const source = readUiSource("src/app/dashboard/growth/page.tsx");
    expect(source).toContain("Conversão, CAC e atribuição não são inferidos");
    expect(source).toContain("Semântica pendente");
    expect(source).not.toContain("Math.random");
  });
});
