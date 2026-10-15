import { createMoney, type Money } from "./money";

/** Pedido genérico a um modelo de linguagem. A escolha do provedor nunca fica aqui (ADR-017). */
export interface ProviderRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
}

export interface ProviderResult {
  readonly text: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
  /** true quando o provedor não informou o uso e os tokens foram estimados (caracteres / 4). */
  readonly estimated: boolean;
}

export interface AiProvider {
  readonly id: string;
  invoke(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResult>;
}

/**
 * Falha do provedor que vale tentar de novo ou em outro provedor: tempo esgotado, rede, 429, 5xx.
 */
export class ProviderTransientError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ProviderTransientError"; }
}

/**
 * Falha que não é do pedido, mas daquele provedor (chave recusada, endereço errado, resposta fora do contrato):
 * não adianta repetir nele, mas o reserva pode atender.
 */
export class ProviderRejectedError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ProviderRejectedError"; }
}

/** O pedido em si é inválido (400/422): falharia em qualquer provedor, então não há troca para o reserva. */
export class ProviderBadRequestError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ProviderBadRequestError"; }
}

/** Nenhum provedor disponível para a tarefa: sem linha, todos permitidos fora do ar, ou todos falharam. */
export class NoProviderAvailableError extends Error {
  constructor(readonly attempted: readonly string[], readonly reason: string) {
    super(`ai.no_provider_available:${reason}`);
    this.name = "NoProviderAvailableError";
  }
}

/** Preço em unidades menores da moeda (centavos) por milhão de tokens. */
export interface ProviderPricing {
  readonly currency: string;
  readonly inputMinorPerMillion: number;
  readonly outputMinorPerMillion: number;
}

/**
 * Custo exato em "micro-unidades menores" (um milionésimo de centavo). Tokens x preço por milhão já dá
 * esse inteiro, sem arredondar. Arredondar cada chamada para 1 centavo multiplicaria o custo real por dezenas.
 */
export function costMicroMinor(tokensIn: number, tokensOut: number, pricing: ProviderPricing): number {
  const v = tokensIn * pricing.inputMinorPerMillion + tokensOut * pricing.outputMinorPerMillion;
  if (!Number.isSafeInteger(v)) throw new Error("ai.cost_overflow");
  return v;
}

/** Converte o total em Money só na hora de mostrar ou cobrar, arredondando uma vez. */
export function microToMoney(totalMicroMinor: number, currency: string) {
  return createMoney(Math.round(totalMicroMinor / 1_000_000), currency);
}

export type { Money };

export interface ProviderConfig {
  readonly id: string;
  readonly kind: "openai_compatible";
  readonly baseUrl: string;
  readonly model: string;
  /** Referência ao segredo, nunca o segredo: "env://NOME_DA_VARIAVEL". */
  readonly secretRef: string;
  readonly timeoutMs: number;
  readonly pricing: ProviderPricing;
}

/** So variaveis AI_KEY_*: impede apontar para DATABASE_URL, BETTER_AUTH_SECRET etc. */
const SECRET_REF = /^env:\/\/AI_KEY_[A-Z0-9_]{1,56}$/;
export const MAX_TOKENS_IN = 5_000_000;
export const MAX_TOKENS_OUT = 1_000_000;
const MAX_PRICE_MINOR = 100_000_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Enderecos que nunca devem receber chamadas de IA: loopback, rede privada, link-local e metadados de nuvem (SSRF). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("::ffff:")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** `allowLocal` so para teste e desenvolvimento (FMCC_AI_ALLOW_LOCAL_PROVIDERS=1): libera http://localhost. */
export function validateProviderConfig(c: ProviderConfig, options: { allowLocal?: boolean } = {}): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(c.id)) errors.push("provider.id_invalid");
  if (!c.model.trim()) errors.push("provider.model_required");
  if (!SECRET_REF.test(c.secretRef)) errors.push("provider.secret_ref_must_be_env_reference");
  if (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 1_000 || c.timeoutMs > 120_000) errors.push("provider.timeout_1s_to_120s");
  try {
    const u = new URL(c.baseUrl);
    const local = LOCAL_HOSTS.has(u.hostname);
    if (options.allowLocal && local) {
      if (u.protocol !== "http:" && u.protocol !== "https:") errors.push("provider.base_url_must_be_https");
    } else {
      if (u.protocol !== "https:") errors.push("provider.base_url_must_be_https");
      if (isPrivateHost(u.hostname)) errors.push("provider.base_url_private_address_not_allowed");
    }
    if (u.username || u.password) errors.push("provider.base_url_must_not_embed_credentials");
  } catch { errors.push("provider.base_url_invalid"); }
  if (!/^[A-Z]{3}$/.test(c.pricing.currency)) errors.push("provider.currency_must_be_iso_4217");
  for (const k of ["inputMinorPerMillion", "outputMinorPerMillion"] as const)
    if (!Number.isSafeInteger(c.pricing[k]) || c.pricing[k] < 0 || c.pricing[k] > MAX_PRICE_MINOR) errors.push(`provider.${k}_invalid`);
  return errors;
}
