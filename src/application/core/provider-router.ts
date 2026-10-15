import { Bulkhead, CircuitBreaker } from "@/domain/core/resilience";
import {
  costMicroMinor, NoProviderAvailableError, ProviderBadRequestError, ProviderRejectedError, ProviderTransientError,
  type AiProvider, type ProviderConfig, type ProviderPricing, type ProviderRequest,
} from "@/domain/core/ai-provider";
import { resolveRoute, type ProviderState, type RoutingRow } from "@/domain/core/routing-policy";
import type { TaskType } from "@/domain/core/task-envelope";
import { logEvent } from "@/infrastructure/observability/logger";

/** Configuração lida do banco: provedores, tabela de roteamento e provedores permitidos por empresa. */
export interface AiConfigSnapshot {
  readonly providers: readonly ProviderConfig[];
  readonly rows: readonly RoutingRow[];
  readonly allowedByTenant: Readonly<Record<string, readonly string[]>>;
}

export interface UsageRecord {
  readonly tenantId: string;
  readonly unitId: string | null;
  readonly taskId: string;
  readonly attempt: number;
  readonly taskType: TaskType;
  readonly providerId: string;
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly estimated: boolean;
  readonly costMicroMinor: number;
  readonly currency: string;
  readonly occurredAt: Date;
}

export interface AiConfigSource {
  load(): Promise<AiConfigSnapshot>;
  recordUsage(record: UsageRecord): Promise<void>;
}

export interface RouterOptions {
  readonly config: AiConfigSource;
  readonly makeProvider: (config: ProviderConfig) => AiProvider;
  readonly configTtlMs?: number;
  readonly failureThreshold?: number;
  readonly openMs?: number;
  readonly random?: () => number;
  readonly now?: () => number;
}

export interface ExecuteInput {
  readonly tenantId: string;
  readonly unitId?: string | null;
  readonly taskId: string;
  /** Numero da tentativa da fila; junto com o provedor identifica a chamada paga. */
  readonly attempt?: number;
  readonly taskType: TaskType;
  readonly request: ProviderRequest;
  readonly signal?: AbortSignal;
}

export interface ExecuteResult {
  readonly text: string;
  readonly providerId: string;
  readonly role: "primary" | "reserve";
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costMicroMinor: number;
  readonly currency: string;
  /** Provedores tentados, em ordem; o último é o que respondeu. */
  readonly attempted: readonly string[];
}

const BREAKER_REJECTIONS = new Set(["ai.provider_http_401", "ai.provider_http_404", "ai.provider_secret_missing", "ai.provider_response_not_json", "ai.provider_response_empty", "ai.provider_usage_out_of_range"]);
function breakerRelevant(code: string): boolean { return BREAKER_REJECTIONS.has(code); }

interface Runtime { provider: AiProvider; breaker: CircuitBreaker; bulkhead: Bulkhead; pricing: ProviderPricing; model: string; cfgKey: string }

/**
 * Executa uma tarefa de IA seguindo a política salva (ADR-017): linha do cliente vence a padrão, provedores do mesmo
 * nível dividem por peso, cada provedor tem limite de simultâneas e disjuntor, e falha transitória passa ao reserva.
 * A escolha vem da tabela, nunca de uma IA.
 */
export class ProviderRouter {
  private snapshot: AiConfigSnapshot | null = null;
  private loadedAt = 0;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly ttl: number;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly opts: RouterOptions) {
    this.ttl = opts.configTtlMs ?? 5_000;
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
  }

  private async config(): Promise<AiConfigSnapshot> {
    if (!this.snapshot || this.now() - this.loadedAt > this.ttl) {
      this.snapshot = await this.opts.config.load();
      this.loadedAt = this.now();
    }
    return this.snapshot;
  }

  /** `maxConcurrent` aqui e o teto do provedor (maior valor entre as linhas); o limite de cada linha e aplicado pela politica. */
  private runtime(cfg: ProviderConfig, maxConcurrent: number): Runtime {
    const cfgKey = JSON.stringify([cfg.baseUrl, cfg.model, cfg.secretRef, cfg.timeoutMs, cfg.pricing, maxConcurrent]);
    const cur = this.runtimes.get(cfg.id);
    if (cur && cur.cfgKey === cfgKey) return cur;
    const rt: Runtime = {
      provider: this.opts.makeProvider(cfg),
      // Disjuntor e contagem preservados quando so o peso muda; recriados se endereco/limite mudam.
      breaker: cur?.breaker ?? new CircuitBreaker({ failureThreshold: this.opts.failureThreshold ?? 5, openMs: this.opts.openMs ?? 15_000 }, this.now),
      bulkhead: cur && cur.bulkhead.maxConcurrent === maxConcurrent ? cur.bulkhead : new Bulkhead(maxConcurrent),
      pricing: cfg.pricing, model: cfg.model, cfgKey,
    };
    this.runtimes.set(cfg.id, rt);
    return rt;
  }

  /** Ha alguma rota configurada (linha do cliente ou padrao) para este tipo de tarefa? Usado para escolher entre a politica do banco e o modelo unico da V1. */
  async hasRoute(tenantId: string, taskType: TaskType): Promise<boolean> {
    const cfg = await this.config();
    const ids = new Set(cfg.providers.map((p) => p.id));
    return cfg.rows.some((r) => r.taskType === taskType && ids.has(r.providerId) && (r.tenantId === null || r.tenantId === tenantId));
  }

  async execute(input: ExecuteInput): Promise<ExecuteResult> {
    const cfg = await this.config();
    const byId = new Map(cfg.providers.map((p) => [p.id, p]));
    const allowed = cfg.allowedByTenant[input.tenantId];
    const rows = cfg.rows.filter((r) => byId.has(r.providerId));
    const ceiling = new Map<string, number>();
    for (const r of rows) ceiling.set(r.providerId, Math.max(ceiling.get(r.providerId) ?? 1, r.maxConcurrent));
    const excluded = new Set<string>();
    const attempted: string[] = [];
    let lastReason = "no_route";

    for (let guard = 0; guard <= rows.length; guard++) {
      const state: Record<string, ProviderState> = {};
      for (const r of rows) {
        const pc = byId.get(r.providerId)!;
        const rt = this.runtime(pc, ceiling.get(r.providerId)!);
        state[r.providerId] = { circuitOpen: excluded.has(r.providerId) || rt.breaker.state === "open", inFlight: rt.bulkhead.current };
      }
      const route = resolveRoute({
        rows, taskType: input.taskType, tenantId: input.tenantId, allowedProviders: allowed,
        providerState: state, pick: this.random(),
      });
      if (!route.ok) throw new NoProviderAvailableError(attempted, attempted.length > 0 ? lastReason : route.errors[0] ?? "no_route");
      const providerId = route.value.providerId;
      const rt = this.runtime(byId.get(providerId)!, ceiling.get(providerId)!);

      const release = rt.bulkhead.tryAcquire();
      if (!release) { excluded.add(providerId); lastReason = "provider_busy"; continue; }
      if (!rt.breaker.allow()) { release(); excluded.add(providerId); lastReason = "circuit_open"; continue; }
      attempted.push(providerId);
      try {
        const out = await rt.provider.invoke(input.request, input.signal ?? new AbortController().signal);
        rt.breaker.recordSuccess();
        // A resposta ja foi paga: custo e registro ficam fora da logica de troca de provedor (nunca geram segunda chamada).
        let cost = 0;
        try { cost = costMicroMinor(out.tokensIn, out.tokensOut, rt.pricing); }
        catch { cost = Number.MAX_SAFE_INTEGER; logEvent("error", "ai_cost_overflow", { providerId, taskId: input.taskId }); }
        await this.opts.config.recordUsage({
          tenantId: input.tenantId, unitId: input.unitId ?? null, taskId: input.taskId, attempt: input.attempt ?? 1, taskType: input.taskType,
          providerId, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut, estimated: out.estimated,
          costMicroMinor: cost, currency: rt.pricing.currency, occurredAt: new Date(this.now()),
        }).catch((err: unknown) => {
          // falha ao registrar uso nao pode jogar fora uma resposta ja paga, mas precisa ficar visivel
          logEvent("error", "ai_usage_record_failed", { providerId, taskId: input.taskId, errorType: err instanceof Error ? err.name : "unknown" });
        });
        return {
          text: out.text, providerId, role: route.value.role, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut,
          costMicroMinor: cost, currency: rt.pricing.currency, attempted,
        };
      } catch (e) {
        if (e instanceof ProviderBadRequestError) { rt.breaker.recordSuccess(); throw e; } // o provedor esta bem; o pedido e que e invalido
        if (e instanceof ProviderTransientError || e instanceof ProviderRejectedError) {
          if (input.signal?.aborted) { rt.breaker.cancelProbe(); throw e; } // cancelado por quem chamou: nao culpa o provedor
          // Rejeicao por conteudo (ex.: 403 de filtro) so afeta aquele pedido; so erro do proprio provedor/configuracao abre o disjuntor de todos.
          if (e instanceof ProviderTransientError || breakerRelevant(e.code)) rt.breaker.recordFailure(); else rt.breaker.cancelProbe();
          excluded.add(providerId);
          lastReason = e.code;
          continue;
        }
        rt.breaker.recordFailure();
        excluded.add(providerId);
        lastReason = "ai.provider_unexpected_error";
      } finally {
        release();
      }
    }
    throw new NoProviderAvailableError(attempted, lastReason);
  }
}
