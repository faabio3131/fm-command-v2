export interface KordenaRuntimeBootstrapConfig {
  readonly tenantId: string;
  readonly baseUrl: string;
  readonly verifyOnStartup: boolean;
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function kordenaRuntimeBootstrapConfig(
  env: NodeJS.ProcessEnv = process.env,
): KordenaRuntimeBootstrapConfig | null {
  if (!enabled(env.FMCC_KORDENA_RUNTIME_BOOTSTRAP)) return null;

  const tenantId = env.FMCC_KORDENA_CONTROL_TENANT_ID?.trim();
  const baseUrlRaw = env.FMCC_KORDENA_BASE_URL?.trim();
  if (!tenantId) throw new Error("config.FMCC_KORDENA_CONTROL_TENANT_ID_missing");
  if (!baseUrlRaw) throw new Error("config.FMCC_KORDENA_BASE_URL_missing");

  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlRaw);
  } catch {
    throw new Error("config.FMCC_KORDENA_BASE_URL_invalid");
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) {
    throw new Error("config.FMCC_KORDENA_BASE_URL_insecure");
  }

  const allowedOrigins = (env.FMCC_KORDENA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin);
  if (!allowedOrigins.includes(baseUrl.origin)) {
    throw new Error("config.FMCC_KORDENA_BASE_URL_not_allowlisted");
  }

  return {
    tenantId,
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    verifyOnStartup: enabled(env.FMCC_KORDENA_RUNTIME_BOOTSTRAP_VERIFY),
  };
}
