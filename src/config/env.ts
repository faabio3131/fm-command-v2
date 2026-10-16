const MIN_AUTH_SECRET_LENGTH = 32;
const MIN_MODEL_API_KEY_LENGTH = 12;

function required(name: "DATABASE_URL" | "BETTER_AUTH_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`config.missing:${name}`);
  return value;
}

export function serverEnv() {
  const secret = required("BETTER_AUTH_SECRET");
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error("config.BETTER_AUTH_SECRET_too_short");
  }
  return {
    databaseUrl: required("DATABASE_URL"),
    authSecret: secret,
    authUrl: process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000",
  } as const;
}

export function cognitiveEnv() {
  const baseUrl = process.env.FMCC_COGNITIVE_MODEL_BASE_URL?.trim();
  const apiKey = process.env.FMCC_COGNITIVE_MODEL_API_KEY?.trim();
  const modelId = process.env.FMCC_COGNITIVE_MODEL_ID?.trim();

  if (!baseUrl || !apiKey || !modelId) {
    throw new Error("config.cognitive_model_incomplete");
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("config.cognitive_model_base_url_invalid");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("config.cognitive_model_base_url_insecure");
  }
  if (apiKey.length < MIN_MODEL_API_KEY_LENGTH) {
    throw new Error("config.cognitive_model_api_key_too_short");
  }

  return { baseUrl: parsed.toString(), apiKey, modelId } as const;
}


export function alertAutomationEnv() {
  const schedulerSecret = process.env.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET?.trim();
  if (!schedulerSecret || schedulerSecret.length < 32) {
    throw new Error("config.FMCC_ALERT_AUTOMATION_SCHEDULER_SECRET_invalid");
  }
  return { schedulerSecret } as const;
}
