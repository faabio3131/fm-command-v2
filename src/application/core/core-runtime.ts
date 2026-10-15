import { pool } from "@/infrastructure/db/client";
import { PostgresWorkQueue } from "@/infrastructure/core/postgres-work-queue";
import { PostgresAiConfig } from "@/infrastructure/core/postgres-ai-config";
import { OpenAiCompatibleProvider } from "@/infrastructure/core/openai-compatible-provider";
import { ProviderRouter } from "@/application/core/provider-router";
import { AsyncCoreQueryService } from "@/application/core/async-core-query";
import { createAiTaskHandler } from "@/application/core/ai-task-handler";
import { createCoreQueryHandler } from "@/application/core/core-query-handler";
import { runWorker, type HandlerRegistry } from "@/application/core/work-worker";
import { logEvent } from "@/infrastructure/observability/logger";

const g = globalThis as unknown as {
  fmccWorkQueue?: PostgresWorkQueue; fmccProviderRouter?: ProviderRouter; fmccWorkerStop?: AbortController;
};

export function sharedWorkQueue(): PostgresWorkQueue {
  return (g.fmccWorkQueue ??= new PostgresWorkQueue(pool));
}

export function sharedProviderRouter(): ProviderRouter {
  return (g.fmccProviderRouter ??= new ProviderRouter({
    config: new PostgresAiConfig(pool),
    makeProvider: (cfg) => new OpenAiCompatibleProvider(cfg),
  }));
}

export function asyncCoreQueryService(): AsyncCoreQueryService {
  return new AsyncCoreQueryService(sharedWorkQueue(), pool);
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function startCoreWorkers(): void {
  if (g.fmccWorkerStop) return;
  const stop = (g.fmccWorkerStop = new AbortController());
  const router = sharedProviderRouter();
  const handlers: HandlerRegistry = {
    core_query: createCoreQueryHandler({ router }),
    analysis: createAiTaskHandler(router), synthesis: createAiTaskHandler(router), attendance: createAiTaskHandler(router),
    transcription: createAiTaskHandler(router), decision: createAiTaskHandler(router),
  };
  const concurrency = intEnv("FMCC_CORE_WORKER_CONCURRENCY", 4, 1, 64);
  const options = {
    leaseMs: 90_000, maxPerTenant: intEnv("FMCC_CORE_WORKER_MAX_PER_TENANT", 3, 1, 64), handlers, idleMs: 500, stop: stop.signal,
  };
  for (let i = 0; i < concurrency; i++) {
    void runWorker(sharedWorkQueue(), { ...options, workerId: `core-${process.pid}-${i}` })
      .catch((e) => logEvent("error", "core_worker_crashed", { errorType: e instanceof Error ? e.name : "unknown" }));
  }
  process.once("SIGTERM", () => stop.abort());
  logEvent("info", "core_workers_started", { concurrency });
}
