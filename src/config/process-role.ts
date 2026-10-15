/**
 * Papel deste processo (ADR-016).
 * - all: faz tudo, como na V1 (padrão; nada muda para quem não configura).
 * - operation: painéis, alertas, cobrança e integrações. Nunca chama o modelo de IA: encaminha ao processo de IA.
 * - ai: só atende as rotas que usam IA.
 */
export type ProcessRole = "all" | "operation" | "ai";

export function processRole(env: Record<string, string | undefined> = process.env): ProcessRole {
  const raw = env.FMCC_PROCESS_ROLE?.trim().toLowerCase();
  if (!raw) return "all";
  if (raw === "all" || raw === "operation" || raw === "ai") return raw;
  throw new Error("config.FMCC_PROCESS_ROLE_invalid");
}

export interface AiServiceConfig {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxConcurrent: number;
  readonly failureThreshold: number;
  readonly openMs: number;
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`config.${name}_invalid`);
  return n;
}

/** Endereço interno do processo de IA e limites da ponte. Sem endereço, o processo de operação recusa (nunca chama o modelo). */
export function aiServiceConfig(env: Record<string, string | undefined> = process.env): AiServiceConfig | null {
  const raw = env.FMCC_AI_SERVICE_URL?.trim();
  if (!raw) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("config.FMCC_AI_SERVICE_URL_invalid"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("config.FMCC_AI_SERVICE_URL_invalid");
  return {
    baseUrl: parsed.origin,
    timeoutMs: positiveInt(env.FMCC_AI_PROXY_TIMEOUT_MS, 35_000, "FMCC_AI_PROXY_TIMEOUT_MS"),
    maxConcurrent: positiveInt(env.FMCC_AI_PROXY_MAX_CONCURRENT, 32, "FMCC_AI_PROXY_MAX_CONCURRENT"),
    failureThreshold: positiveInt(env.FMCC_AI_PROXY_FAILURE_THRESHOLD, 5, "FMCC_AI_PROXY_FAILURE_THRESHOLD"),
    openMs: positiveInt(env.FMCC_AI_PROXY_OPEN_MS, 15_000, "FMCC_AI_PROXY_OPEN_MS"),
  };
}

/** O processo de operacao nunca executa IA (ADR-016). Nos demais, o worker liga sozinho, salvo FMCC_CORE_WORKER=off. */
export function coreWorkerEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const role = env.FMCC_PROCESS_ROLE?.trim().toLowerCase() || "all";
  if (role === "operation") return false;
  return env.FMCC_CORE_WORKER?.trim().toLowerCase() !== "off";
}

