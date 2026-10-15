import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FMCC governed cognitive capability architecture", () => {
  it("mantém a capability Kordena somente leitura e sem acesso direto a banco", () => {
    const capability = readFileSync(
      "src/application/core/kordena-commercial-summary-capability.ts",
      "utf8",
    );

    expect(capability).toContain('requirePermission(context, "commercial:read")');
    expect(capability).toContain("KordenaCommercialControlService");
    expect(capability).toContain("control.snapshot");
    expect(capability).not.toContain("control.command");
    expect(capability).not.toContain("commercial:write");
    expect(capability).not.toContain("@/infrastructure/db");
    expect(capability).not.toContain("drizzle-orm");
    expect(capability).not.toContain(".insert(");
    expect(capability).not.toContain(".update(");
    expect(capability).not.toContain(".delete(");
  });

  it("não oferece capability mutacional ao planner cognitivo", () => {
    const composition = readFileSync(
      "src/application/core/core-composition.ts",
      "utf8",
    );
    const gateway = readFileSync(
      "src/application/core/core-gateway.ts",
      "utf8",
    );

    expect(composition).toContain("KordenaCommercialSummaryCapability");
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
