import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FMCC cognitive architecture ownership", () => {
  it("mantém o Core cognitivo vertical dentro do produto", () => {
    const composition = readFileSync("src/application/core/core-composition.ts", "utf8");
    const verticalCore = readFileSync("src/application/core/fmcc-vertical-cognitive-core.ts", "utf8");

    expect(composition).toContain("FmccVerticalCognitiveCore");
    expect(verticalCore).toContain("METRIC_REGISTRY");
    expect(verticalCore).toContain("CognitiveModel");
  });

  it("não depende do runtime cognitivo de outro SaaS", () => {
    const composition = readFileSync("src/application/core/core-composition.ts", "utf8");
    const envExample = readFileSync(".env.example", "utf8");

    expect(composition).not.toContain("FM_CORE_BASE_URL");
    expect(composition).not.toContain("FM_CORE_SERVICE_TOKEN");
    expect(envExample).not.toContain("FM_CORE_BASE_URL");
    expect(envExample).not.toContain("FM_CORE_SERVICE_TOKEN");
    expect(existsSync("src/infrastructure/core/http-core-client.ts")).toBe(false);
  });

  it("mantém modelo externo como provider e não como autoridade factual", () => {
    const gateway = readFileSync("src/application/core/core-gateway.ts", "utf8");
    const adapter = readFileSync("src/infrastructure/core/openai-compatible-cognitive-model.ts", "utf8");

    expect(gateway).toContain("this.metrics.query");
    expect(gateway).toContain("this.core.synthesize");
    expect(adapter).toContain("Selecione SOMENTE metricIds presentes no catálogo");
    expect(adapter).toContain("Nunca invente números");
  });

  it("degrada configuração cognitiva inválida para erro de provider indisponível", () => {
    const composition = readFileSync("src/application/core/core-composition.ts", "utf8");

    expect(composition).toContain("CognitiveModelUnavailableError");
    expect(composition).toContain("try {");
    expect(composition).toContain("config = cognitiveEnv()");
    expect(composition).toContain("throw new CognitiveModelUnavailableError()");
  });

  it("declara variáveis cognitivas no blueprint de Preview sem versionar segredos", () => {
    const blueprint = readFileSync("deploy/render.blueprint.example.yaml", "utf8");

    expect(blueprint).toContain("FMCC_COGNITIVE_MODEL_BASE_URL");
    expect(blueprint).toContain("FMCC_COGNITIVE_MODEL_API_KEY");
    expect(blueprint).toContain("FMCC_COGNITIVE_MODEL_ID");
    expect(blueprint).not.toContain("replace-with-runtime-secret");
  });
});
