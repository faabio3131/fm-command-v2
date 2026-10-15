import type { ClaimOptions, WorkItem, WorkQueue, WorkType } from "@/domain/core/work-queue";

/** Erro que nao adianta repetir (dado invalido, permissao negada...): a tarefa vai direto para "dead". */
export class PermanentTaskError extends Error {
  constructor(message: string) { super(message); this.name = "PermanentTaskError"; }
}

export type TaskHandler = (item: WorkItem, signal: AbortSignal) => Promise<Record<string, unknown>>;
export type HandlerRegistry = Partial<Record<WorkType, TaskHandler>>;

export interface WorkerOptions extends ClaimOptions {
  readonly handlers: HandlerRegistry;
  /** Intervalo da renovacao da posse; padrao: um terco do prazo. */
  readonly heartbeatMs?: number;
}

export type ProcessOutcome = "idle" | "succeeded" | "retry_scheduled" | "dead" | "expired" | "lease_lost";

/**
 * Pega UMA tarefa, executa, renova a posse enquanto roda e registra o resultado.
 * Se a posse for perdida (worker lento demais), o resultado e descartado: outro worker assumiu.
 */
export async function processOne(queue: WorkQueue, options: WorkerOptions): Promise<ProcessOutcome> {
  const item = await queue.claim(options);
  if (!item) return "idle";
  const handler = options.handlers[item.taskType];
  if (!handler) {
    const r = await queue.fail(item.id, item.leaseToken, `worker.no_handler:${item.taskType}`, false);
    return r;
  }
  const abort = new AbortController();
  const every = options.heartbeatMs ?? Math.max(10, Math.floor(options.leaseMs / 3));
  const timer = setInterval(() => {
    queue.heartbeat(item.id, item.leaseToken, options.leaseMs)
      .then((alive) => { if (!alive) abort.abort(); })
      .catch(() => { /* proximo ciclo tenta de novo; se a posse expirar, outro worker assume */ });
  }, every);
  try {
    const result = await handler(item, abort.signal);
    const done = await queue.complete(item.id, item.leaseToken, result);
    return done ? "succeeded" : "lease_lost";
  } catch (e) {
    const permanent = e instanceof PermanentTaskError;
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : "unknown_error";
    return queue.fail(item.id, item.leaseToken, msg, !permanent);
  } finally {
    clearInterval(timer);
  }
}

/** Laco do worker: processa ate `stop` ser acionado; dorme `idleMs` quando nao ha trabalho. */
export async function runWorker(queue: WorkQueue, options: WorkerOptions & { idleMs: number; stop: AbortSignal }): Promise<void> {
  while (!options.stop.aborted) {
    let outcome: ProcessOutcome;
    try {
      await queue.sweepExpired();
      outcome = await processOne(queue, options);
    } catch {
      outcome = "idle"; // falha de banco: espera e tenta de novo, sem derrubar o processo
    }
    if (outcome === "idle") await sleep(options.idleMs, options.stop);
  }
}

function sleep(ms: number, stop: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); stop.removeEventListener("abort", done); resolve(); }
    stop.addEventListener("abort", done, { once: true });
  });
}
