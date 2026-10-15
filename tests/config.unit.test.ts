import { afterEach, describe, expect, it } from "vitest";
import { cognitiveEnv, serverEnv } from "@/config/env";

const original = {
  databaseUrl: process.env.DATABASE_URL,
  authSecret: process.env.BETTER_AUTH_SECRET,
  cognitiveBaseUrl: process.env.FMCC_COGNITIVE_MODEL_BASE_URL,
  cognitiveApiKey: process.env.FMCC_COGNITIVE_MODEL_API_KEY,
  cognitiveModelId: process.env.FMCC_COGNITIVE_MODEL_ID,
};

afterEach(() => {
  process.env.DATABASE_URL = original.databaseUrl;
  process.env.BETTER_AUTH_SECRET = original.authSecret;
  process.env.FMCC_COGNITIVE_MODEL_BASE_URL = original.cognitiveBaseUrl;
  process.env.FMCC_COGNITIVE_MODEL_API_KEY = original.cognitiveApiKey;
  process.env.FMCC_COGNITIVE_MODEL_ID = original.cognitiveModelId;
});

describe("server config", () => {
  it("falha fechado sem secret", () => {
    process.env.DATABASE_URL = "postgresql://example";
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => serverEnv()).toThrow("config.missing:BETTER_AUTH_SECRET");
  });

  it("rejeita secret curto", () => {
    process.env.DATABASE_URL = "postgresql://example";
    process.env.BETTER_AUTH_SECRET = "short";
    expect(() => serverEnv()).toThrow("config.BETTER_AUTH_SECRET_too_short");
  });
});

describe("FMCC cognitive runtime config", () => {
  it("falha fechado quando a configuração cognitiva está incompleta", () => {
    process.env.FMCC_COGNITIVE_MODEL_BASE_URL = "https://models.example.test";
    delete process.env.FMCC_COGNITIVE_MODEL_API_KEY;
    process.env.FMCC_COGNITIVE_MODEL_ID = "approved-model";

    expect(() => cognitiveEnv()).toThrow("config.cognitive_model_incomplete");
  });

  it("rejeita endpoint cognitivo inseguro fora de localhost", () => {
    process.env.FMCC_COGNITIVE_MODEL_BASE_URL = "http://models.example.test";
    process.env.FMCC_COGNITIVE_MODEL_API_KEY = "unit-test-secret-key";
    process.env.FMCC_COGNITIVE_MODEL_ID = "approved-model";

    expect(() => cognitiveEnv()).toThrow("config.cognitive_model_base_url_insecure");
  });

  it("aceita configuração completa e segura", () => {
    process.env.FMCC_COGNITIVE_MODEL_BASE_URL = "https://models.example.test";
    process.env.FMCC_COGNITIVE_MODEL_API_KEY = "unit-test-secret-key";
    process.env.FMCC_COGNITIVE_MODEL_ID = "approved-model";

    expect(cognitiveEnv()).toMatchObject({
      apiKey: "unit-test-secret-key",
      modelId: "approved-model",
    });
  });
});
