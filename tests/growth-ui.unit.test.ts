import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("F13 growth UI", () => {
  it("expõe gaps comerciais sem fabricar atribuição", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/dashboard/growth/page.tsx"), "utf8");
    expect(source).toContain("Conversão, CAC e atribuição não são inferidos");
    expect(source).toContain("Semântica pendente");
    expect(source).not.toContain("Math.random");
  });
});
