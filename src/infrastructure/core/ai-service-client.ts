import { Bulkhead, CircuitBreaker } from "@/domain/core/resilience";
import { logEvent } from "@/infrastructure/observability/logger";
import type { AiServiceConfig } from "@/config/process-role";

/** Só estes cabeçalhos seguem para o processo de IA: a sessão é validada de novo lá. */
const FORWARDED_HEADERS = ["cookie", "content-type", "accept-language", "x-correlation-id"] as const;

export interface AiBridge {
  forward(request: Request): Promise<Response>;
}

function json(status: number, error: string, retryAfterSeconds?: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}) },
  });
}

/**
 * Ponte do processo de operação até o processo de IA, com limite de simultâneas, disjuntor e tempo máximo.
 * O processo de operação nunca espera o modelo: no pior caso espera `timeoutMs` por uma vaga limitada.
 * Erros do usuário (4xx) passam direto e não contam como falha; 5xx e rede contam.
 */
export function createAiBridge(
  config: AiServiceConfig,
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): AiBridge {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const bulkhead = new Bulkhead(config.maxConcurrent);
  const breaker = new CircuitBreaker({ failureThreshold: config.failureThreshold, openMs: config.openMs }, deps.now);

  return {
    async forward(request) {
      const release = bulkhead.tryAcquire();
      if (!release) {
        logEvent("warn", "ai_bridge_rejected", { reason: "capacity" });
        return json(503, "core.ai_capacity_exceeded", 1);
      }
      try {
        if (!breaker.allow()) {
          logEvent("warn", "ai_bridge_rejected", { reason: "circuit_open" });
          return json(503, "core.ai_service_unavailable", Math.ceil(config.openMs / 1000));
        }
        const headers = new Headers();
        for (const name of FORWARDED_HEADERS) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        try {
          const upstream = await fetchImpl(new URL("/api/core/query", config.baseUrl), {
            method: "POST", headers, body: await request.text(), signal: controller.signal,
          });
          const body = await upstream.text();
          if (upstream.status >= 500) breaker.recordFailure(); else breaker.recordSuccess();
          return new Response(body, {
            status: upstream.status,
            headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
          });
        } catch (error) {
          breaker.recordFailure();
          logEvent("warn", "ai_bridge_upstream_error", { errorType: error instanceof Error ? error.name : "unknown" });
          return json(503, "core.ai_service_unavailable", 1);
        } finally {
          clearTimeout(timer);
        }
      } finally {
        release();
      }
    },
  };
}

let shared: { key: string; bridge: AiBridge } | undefined;

/** Uma ponte por processo: o limite e o disjuntor valem para todas as requisições juntas. */
export function sharedAiBridge(config: AiServiceConfig): AiBridge {
  const key = JSON.stringify(config);
  if (!shared || shared.key !== key) shared = { key, bridge: createAiBridge(config) };
  return shared.bridge;
}
