import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { CoreArgumentError } from "@/application/core/core-gateway";
import type { CoreAnswer } from "@/domain/core/contracts";
import type { WorkQueue } from "@/domain/core/work-queue";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

/** Limites que protegem a fila e o custo: uma pessoa nao enche a fila da empresa, e uma empresa nao enche a fila de todas. */
export const CORE_QUERY_LIMITS = { perUser: 3, perTenant: 40, deadlineMs: 120_000, maxAttempts: 2, interactivePriority: 70 } as const;

export class CoreQueueBusyError extends Error {
  constructor(readonly code: "core.too_many_open_queries" | "core.queue_busy") { super(code); this.name = "CoreQueueBusyError"; }
}

export type CoreQueryStatus =
  | { status: "queued" | "running"; attempt: number }
  | { status: "succeeded"; answer: CoreAnswer }
  | { status: "failed"; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** So codigos conhecidos chegam a tela; o texto bruto do erro nunca sai do servidor. */
export function publicCoreError(state: string, lastError: string | null): string {
  if (state === "expired") return "core.query_timeout";
  const e = lastError ?? "";
  if (e.includes("core.cognitive_model_contract_invalid")) return "core.cognitive_model_contract_invalid";
  if (e.includes("core.cognitive_model_unavailable") || e.includes("ai.no_provider_available")) return "core.cognitive_model_unavailable";
  if (e.includes("core.argument_invalid")) return "core.argument_invalid";
  if (e.includes("security.permission_denied")) return "security.permission_denied";
  return "core.query_failed";
}

export class AsyncCoreQueryService {
  constructor(private readonly queue: WorkQueue, private readonly pool: Pick<Pool, "query">) {}

  async submit(context: TenantContext, input: { question: unknown; productSlugs?: unknown; idempotencyKey?: string | null }): Promise<{ id: string; deduplicated: boolean }> {
    requirePermission(context, "metric:read");
    if (typeof input.question !== "string") throw new CoreArgumentError();
    const question = input.question.trim();
    if (!question || question.length > 4000) throw new CoreArgumentError();
    let productSlugs: string[] | undefined;
    if (input.productSlugs !== undefined) {
      if (!Array.isArray(input.productSlugs) || input.productSlugs.length > 4 || input.productSlugs.some((s) => typeof s !== "string" || s.length > 128)) throw new CoreArgumentError();
      productSlugs = input.productSlugs as string[];
    }
    const key = input.idempotencyKey?.trim();
    if (key !== undefined && key !== "" && (key.length > 128 || !/^[\x21-\x7e]+$/.test(key))) throw new CoreArgumentError();

    const open = await this.pool.query<{ mine: string; tenant: string }>(
      `SELECT count(*) FILTER (WHERE payload->>'userId' = $2) AS mine, count(*) AS tenant
       FROM fmcc_work_item WHERE tenant_id=$1 AND task_type='core_query' AND state IN ('queued','running')`,
      [context.tenantId, context.userId]);
    if (Number(open.rows[0]!.mine) >= CORE_QUERY_LIMITS.perUser) throw new CoreQueueBusyError("core.too_many_open_queries");
    if (Number(open.rows[0]!.tenant) >= CORE_QUERY_LIMITS.perTenant) throw new CoreQueueBusyError("core.queue_busy");

    const r = await this.queue.enqueue({
      tenantId: context.tenantId, taskType: "core_query", priority: CORE_QUERY_LIMITS.interactivePriority, locale: "pt-BR",
      // O que a execucao precisa vem do servidor ja autenticado; o navegador nao escolhe papel nem empresa.
      payload: { question, productSlugs, userId: context.userId, role: context.role, correlationId: context.correlationId },
      idempotencyKey: `cq:${context.userId}:${key || randomUUID()}`,
      maxAttempts: CORE_QUERY_LIMITS.maxAttempts, deadlineInMs: CORE_QUERY_LIMITS.deadlineMs,
    });
    return { id: r.id, deduplicated: !r.inserted };
  }

  /** null = nao existe OU nao e sua: as duas respostas sao iguais para nao revelar consultas de outras pessoas. */
  async status(context: TenantContext, id: string): Promise<CoreQueryStatus | null> {
    requirePermission(context, "metric:read");
    if (!UUID.test(id)) return null;
    const r = await this.pool.query<{ state: string; attempt: number; result: { answer?: CoreAnswer } | null; last_error: string | null }>(
      `SELECT state, attempt, result, last_error FROM fmcc_work_item
       WHERE id=$1 AND tenant_id=$2 AND task_type='core_query' AND payload->>'userId' = $3`, [id, context.tenantId, context.userId]);
    const row = r.rows[0];
    if (!row) return null;
    if (row.state === "queued" || row.state === "running") return { status: row.state, attempt: row.attempt };
    if (row.state === "succeeded" && row.result?.answer) return { status: "succeeded", answer: row.result.answer };
    return { status: "failed", error: publicCoreError(row.state, row.last_error) };
  }
}
