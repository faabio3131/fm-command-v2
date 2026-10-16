import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";

describe("F16 advanced executive UI and audit boundary", () => {
  it("expõe separação epistemológica sem fabricar anomalia risco ou previsão", () => {
    const source = readUiSource("src/app/dashboard/intelligence/page.tsx");
    expect(source).toContain("Fatos, inferências, recomendações e previsões permanecem separados");
    expect(source).toContain("Anomalia");
    expect(source).toContain("Risco");
    expect(source).toContain("Previsão");
    expect(source).toContain("Evidência insuficiente");
    expect(source).not.toContain("Math.random");
  });

  it("registra análise executiva no Audit Ledger", () => {
    const source = readUiSource("src/app/api/intelligence/executive/route.ts");
    expect(source).toContain('action: "executive.analysis"');
    expect(source).toContain('resourceType: "executive_intelligence"');
    expect(source).toContain("anomalyStatus");
    expect(source).toContain("forecastStatus");
  });
});
