import { CHANNEL_KINDS, SEVERITY_ORDER, type ChannelKind, type ChannelSeverity, ChannelProviderError, type DeliveryStatus } from "./contracts";

export const MAX_ATTEMPTS = 5;
/** Quanto um envio pode ficar "enviando" antes de ser tratado como incerto (o processo pode ter caído no meio). */
export const SENDING_LEASE_MS = 5 * 60_000;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 30 * 60_000;

export function isChannelKind(value: unknown): value is ChannelKind {
  return typeof value === "string" && (CHANNEL_KINDS as readonly string[]).includes(value);
}
export function isSeverity(value: unknown): value is ChannelSeverity {
  return typeof value === "string" && (SEVERITY_ORDER as readonly string[]).includes(value);
}

/** Gravidade do alerta alcança o mínimo configurado no canal. */
export function severityMeets(severity: ChannelSeverity, minimum: ChannelSeverity): boolean {
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(minimum);
}

const EMAIL = /^[^\s@<>()[\]\\,;:]+@[^\s@<>()[\]\\,;:]+\.[A-Za-z]{2,}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

/** Endereço válido para o canal; devolve o texto normalizado (e-mail em minúsculas) ou nulo. */
export function normalizeAddress(kind: ChannelKind, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 254) return null;
  if (kind === "email") return EMAIL.test(value) ? value.toLowerCase() : null;
  const digits = value.replace(/[\s().-]/g, "");
  return E164.test(digits) ? digits : null;
}

/** Espera antes da próxima tentativa: dobra a cada tentativa, com teto. */
export function backoffMs(attemptsSoFar: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attemptsSoFar - 1));
}

export interface AttemptDecision {
  readonly status: DeliveryStatus;
  readonly nextAttemptAt: Date | null;
}

/**
 * O que fazer com o recibo depois de uma tentativa. Incerto nunca é reenviado sozinho (poderia duplicar a mensagem);
 * recusado não adianta repetir; transitório repete com espera até o limite.
 */
export function decideAfterFailure(error: ChannelProviderError, attemptsAfter: number, now: Date): AttemptDecision {
  if (error.outcome === "uncertain") return { status: "uncertain", nextAttemptAt: null };
  if (error.outcome === "rejected") return { status: "failed", nextAttemptAt: null };
  if (attemptsAfter >= MAX_ATTEMPTS) return { status: "failed", nextAttemptAt: null };
  return { status: "failed_transient", nextAttemptAt: new Date(now.getTime() + backoffMs(attemptsAfter)) };
}
