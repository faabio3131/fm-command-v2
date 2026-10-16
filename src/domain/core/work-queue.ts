import type { TaskType } from "./task-envelope";

/** Contrato da fila de trabalho do core (ADR-018). Sem dependencia de banco. */
export type WorkState = "queued" | "running" | "succeeded" | "dead" | "expired";

export interface WorkItem {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId: string | null;
  readonly taskType: TaskType;
  readonly priority: number;
  readonly locale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly deadlineAt: Date;
  readonly leaseToken: string;
}

export interface EnqueueInput {
  readonly tenantId: string;
  readonly unitId?: string | null;
  readonly taskType: TaskType;
  readonly priority?: number;
  readonly locale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly maxAttempts?: number;
  /** Prazo em ms a partir de agora. */
  readonly deadlineInMs: number;
}

export interface ClaimOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  /** Maximo de tarefas rodando ao mesmo tempo para uma mesma empresa. */
  readonly maxPerTenant: number;
}

export interface RetryPolicy {
  readonly baseMs: number;
  readonly capMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { baseMs: 1_000, capMs: 5 * 60_000 };

/**
 * Espera antes da proxima tentativa: exponencial com teto e variacao ("jitter") para
 * que muitas tarefas que falharam juntas nao voltem juntas. `random` em [0,1).
 */
export function retryDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY, random: number = Math.random()): number {
  const a = Math.max(1, Math.floor(attempt));
  const exp = Math.min(policy.capMs, policy.baseMs * 2 ** (a - 1));
  return Math.round(exp / 2 + (exp / 2) * Math.min(Math.max(random, 0), 0.999999));
}

export type FailOutcome = "retry_scheduled" | "dead" | "expired" | "lease_lost";

export interface WorkQueue {
  enqueue(input: EnqueueInput): Promise<{ id: string; inserted: boolean }>;
  claim(options: ClaimOptions): Promise<WorkItem | null>;
  heartbeat(id: string, leaseToken: string, leaseMs: number): Promise<boolean>;
  complete(id: string, leaseToken: string, result: Record<string, unknown>): Promise<boolean>;
  fail(id: string, leaseToken: string, error: string, retryable: boolean): Promise<FailOutcome>;
  /** Marca como expiradas as tarefas que passaram do prazo sem terminar. Devolve quantas. */
  sweepExpired(): Promise<number>;
}
