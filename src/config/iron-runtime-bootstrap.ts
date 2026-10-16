export interface IronRuntimeBootstrapConfig {
  readonly tenantId: string;
  readonly baseUrl: string;
  readonly verifyOnStartup: boolean;
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function ironRuntimeBootstrapConfig(
  env: NodeJS.ProcessEnv = process.env,
): IronRuntimeBootstrapConfig | null {
  if (!enabled(env.FMCC_IRON_RUNTIME_BOOTSTRAP)) return null;

  const tenantId = env.FMCC_IRON_CONTROL_TENANT_ID?.trim();
  const baseUrlRaw = env.FMCC_IRON_BASE_URL?.trim();
  if (!tenantId) throw new Error("config.FMCC_IRON_CONTROL_TENANT_ID_missing");
  if (!baseUrlRaw) throw new Error("config.FMCC_IRON_BASE_URL_missing");

  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlRaw);
  } catch {
    throw new Error("config.FMCC_IRON_BASE_URL_invalid");
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) {
    throw new Error("config.FMCC_IRON_BASE_URL_insecure");
  }

  const allowedOrigins = (env.FMCC_IRON_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin);

  if (!allowedOrigins.includes(baseUrl.origin)) {
    throw new Error("config.FMCC_IRON_BASE_URL_not_allowlisted");
  }

  return {
    tenantId,
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    verifyOnStartup: enabled(env.FMCC_IRON_RUNTIME_BOOTSTRAP_VERIFY),
  };
}
