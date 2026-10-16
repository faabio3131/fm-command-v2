import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FMCC governed cognitive capability architecture", () => {
  it("não oferece capability mutacional ao planner cognitivo", () => {
    const composition = readFileSync(
      "src/application/core/core-composition.ts",
      "utf8",
    );
    const gateway = readFileSync(
      "src/application/core/core-gateway.ts",
      "utf8",
    );

    expect(composition).toContain("OperationalHealthCapability");
    expect(composition).not.toContain("KordenaCommercialCommand");
    expect(gateway).toContain("readCapabilities");
    expect(gateway).not.toContain("commercial:write");
  });

  it("obriga provenance antes de dados de capability chegarem ao modelo", () => {
    const gateway = readFileSync(
      "src/application/core/core-gateway.ts",
      "utf8",
    );

    expect(gateway).toContain("sourceAuthority");
    expect(gateway).toContain("freshnessStatus");
    expect(gateway).toContain("qualityStatus");
    expect(gateway).toContain("provenanceRefs");
    expect(gateway).toContain("CoreReadCapabilityContractError");
  });

  it("mantém o planner em allowlist e rejeita ferramenta inventada", () => {
    const adapter = readFileSync(
      "src/infrastructure/core/openai-compatible-cognitive-model.ts",
      "utf8",
    );

    expect(adapter).toContain("allowedCapabilities");
    expect(adapter).toContain("capabilityIds");
    expect(adapter).not.toContain("database.raw_query");
  });
});
