import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/infrastructure/db/client";
import { PostgresWorkQueue } from "@/infrastructure/core/postgres-work-queue";
import { AsyncCoreQueryService, CORE_QUERY_LIMITS, CoreQueueBusyError } from "@/application/core/async-core-query";
import { createCoreQueryHandler } from "@/application/core/core-query-handler";
import { CoreArgumentError, type CoreGateway } from "@/application/core/core-gateway";
import { processOne } from "@/application/core/work-worker";
import { ProviderRouter } from "@/application/core/provider-router";
import { CognitiveModelContractError, CognitiveModelUnavailableError } from "@/domain/core/cognitive-model";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";

const TP = "core-async-";
const ctx = (tenant: string, user: string, role: TenantContext["role"] = "analyst"): TenantContext => ({ tenantId: `${TP}${tenant}`, userId: `${TP}u-${user}`, role, correlationId: `corr-${user}` });
const queue = new PostgresWorkQueue(pool, { baseMs: 5, capMs: 10 }, () => 0.5);
const service = new AsyncCoreQueryService(queue, pool);
const emptyRouter = new ProviderRouter({ config: { load: async () => ({ providers: [], rows: [], allowedByTenant: {} }), recordUsage: async () => undefined }, makeProvider: () => { throw new Error("nao deve ser chamado"); } });
const answer = { answer: "Resposta de teste", evidence: [{ kind: "metric" as const, ref: "trial.starts" }], factualStatus: "grounded" as const };
const gatewayWith = (ask: CoreGateway["ask"]) => ({ ask }) as unknown as CoreGateway;

async function clean() {
  await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id LIKE $1", [`${TP}%`]);
  await pool.query("DELETE FROM fmcc_audit_event WHERE tenant_id LIKE $1", [`${TP}%`]);
}
beforeEach(clean);
afterAll(clean);

async function runOnce(ask: CoreGateway["ask"], roleNow: string | null = "analyst") {
  const handler = createCoreQueryHandler({ router: emptyRouter, makeGateway: () => gatewayWith(ask), currentRole: async () => roleNow });
  return processOne(queue, { workerId: "t", leaseMs: 5000, maxPerTenant: 10, handlers: { core_query: handler } });
}

describe("consulta assincrona ao Core (ADR-016)", () => {
  it("o papel valido e o ATUAL: rebaixado roda com o papel novo; quem saiu da empresa e negado", async () => {
    const c = ctx("role", "1", "admin");
    await service.submit(c, { question: "Como estamos?" });
    let seen: TenantContext | undefined;
    expect(await runOnce(async (context) => { seen = context; return answer; }, "viewer")).toBe("succeeded");
    expect(seen?.role).toBe("viewer");
    await service.submit(ctx("role", "2", "admin"), { question: "Outra?" });
    let called = false;
    expect(await runOnce(async () => { called = true; return answer; }, null)).toBe("dead");
    expect(called).toBe(false);
  });

  it("valida a entrada antes de enfileirar", async () => {
    const c = ctx("a", "1");
    for (const bad of [{ question: 42 }, { question: "   " }, { question: "x".repeat(4001) }, { question: "ok", productSlugs: "a" }, { question: "ok", productSlugs: ["a", "b", "c", "d", "e"] }, { question: "ok", idempotencyKey: "tem espaco" }])
      await expect(service.submit(c, bad)).rejects.toBeInstanceOf(CoreArgumentError);
    expect((await pool.query("SELECT count(*)::int n FROM fmcc_work_item WHERE tenant_id=$1", [c.tenantId])).rows[0].n).toBe(0);
  });

  it("mesma chave de idempotencia = mesma consulta, sem fila duplicada", async () => {
    const c = ctx("b", "1");
    const a = await service.submit(c, { question: "q", idempotencyKey: "abc" });
    const b = await service.submit(c, { question: "q", idempotencyKey: "abc" });
    expect(b).toEqual({ id: a.id, deduplicated: true });
    const other = await service.submit(ctx("b", "2"), { question: "q", idempotencyKey: "abc" });
    expect(other.id).not.toBe(a.id); // a chave vale por pessoa
  });

  it("limita consultas abertas por pessoa e por empresa", async () => {
    const c = ctx("c", "1");
    for (let i = 0; i < CORE_QUERY_LIMITS.perUser; i++) await service.submit(c, { question: `q${i}` });
    await expect(service.submit(c, { question: "mais uma" })).rejects.toMatchObject({ code: "core.too_many_open_queries" });
    await service.submit(ctx("c", "2"), { question: "outra pessoa" }); // outra pessoa da mesma empresa segue
    await service.submit(ctx("d", "1"), { question: "outra empresa" });
    for (let u = 3; u < 3 + 20; u++) for (let i = 0; i < 2; i++) await service.submit(ctx("c", String(u)), { question: `q${i}` }).catch(() => undefined);
    await expect(service.submit(ctx("c", "99"), { question: "x" })).rejects.toBeInstanceOf(CoreQueueBusyError);
    await expect(service.submit(ctx("c", "99"), { question: "x" })).rejects.toMatchObject({ code: "core.queue_busy" });
  });

  it("so quem enviou enxerga a consulta; outra pessoa, outra empresa e id invalido dao o mesmo vazio", async () => {
    const c = ctx("e", "1");
    const { id } = await service.submit(c, { question: "q" });
    expect(await service.status(c, id)).toEqual({ status: "queued", attempt: 0 });
    expect(await service.status(ctx("e", "2"), id)).toBeNull();
    expect(await service.status(ctx("f", "1"), id)).toBeNull();
    expect(await service.status(c, "nao-e-uuid")).toBeNull();
    expect(await service.status(c, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("a execucao usa empresa da fila e papel gravado no envio, entrega a resposta e audita", async () => {
    const c = ctx("g", "1", "viewer");
    const { id } = await service.submit(c, { question: "Como estamos?", productSlugs: ["kordena"] });
    let seen: { context: TenantContext; question: string; scope: unknown } | undefined;
    expect(await runOnce(async (context, question, scope) => { seen = { context, question, scope }; return answer; }, "viewer")).toBe("succeeded");
    expect(seen).toEqual({ context: { tenantId: c.tenantId, userId: c.userId, role: "viewer", correlationId: c.correlationId }, question: "Como estamos?", scope: { productSlugs: ["kordena"] } });
    expect(await service.status(c, id)).toEqual({ status: "succeeded", answer });
    const audit = await pool.query("SELECT action, result, actor_id, metadata FROM fmcc_audit_event WHERE tenant_id=$1", [c.tenantId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: "core.query", result: "success", actor_id: c.userId });
    expect(audit.rows[0].metadata).toMatchObject({ mode: "async", taskId: id });
  });

  it("provedor indisponivel: repete uma vez e depois falha com codigo publico (e audita a falha final)", async () => {
    const c = ctx("h", "1");
    const { id } = await service.submit(c, { question: "q" });
    const ask = async () => { throw new CognitiveModelUnavailableError(); };
    expect(await runOnce(ask)).toBe("retry_scheduled");
    expect(await service.status(c, id)).toMatchObject({ status: "queued", attempt: 1 });
    await new Promise((r) => setTimeout(r, 30));
    expect(await runOnce(ask)).toBe("dead");
    expect(await service.status(c, id)).toEqual({ status: "failed", error: "core.cognitive_model_unavailable" });
    const audit = await pool.query("SELECT result FROM fmcc_audit_event WHERE tenant_id=$1", [c.tenantId]);
    expect(audit.rows).toEqual([{ result: "failure" }]);
  });

  it("erro permanente falha na hora; erro interno nunca vaza o texto para a tela", async () => {
    const c1 = ctx("i", "1"); const a = await service.submit(c1, { question: "q" });
    expect(await runOnce(async () => { throw new CognitiveModelContractError(); })).toBe("dead");
    expect(await service.status(c1, a.id)).toEqual({ status: "failed", error: "core.cognitive_model_contract_invalid" });
    const c2 = ctx("i", "2"); const b = await service.submit(c2, { question: "q" });
    expect(await runOnce(async () => { throw new PermissionDeniedError("metric:read"); })).toBe("dead");
    expect(await service.status(c2, b.id)).toEqual({ status: "failed", error: "security.permission_denied" });
    const c3 = ctx("i", "3"); const d = await service.submit(c3, { question: "q" });
    await runOnce(async () => { throw new Error("password=hunter2 host=db.interno"); });
    await new Promise((r) => setTimeout(r, 30));
    await runOnce(async () => { throw new Error("password=hunter2 host=db.interno"); });
    const st = await service.status(c3, d.id);
    expect(st).toEqual({ status: "failed", error: "core.query_failed" });
    expect(JSON.stringify(st)).not.toContain("hunter2");
  });

  it("consulta que passou do prazo vira falha publica de tempo esgotado", async () => {
    const c = ctx("j", "1");
    const { id } = await service.submit(c, { question: "q" });
    await pool.query("UPDATE fmcc_work_item SET deadline_at = now() - interval '1 second' WHERE id=$1", [id]);
    await queue.sweepExpired();
    expect(await service.status(c, id)).toEqual({ status: "failed", error: "core.query_timeout" });
  });

  it("cancela so a propria consulta aberta; libera o limite; resposta tardia do worker e descartada", async () => {
    const c = ctx("e", "1");
    const q = await service.submit(c, { question: "cancelar na fila" });
    expect(await service.cancel(ctx("e", "2"), q.id)).toBe("not_found"); // outra pessoa
    expect(await service.cancel(ctx("f", "1"), q.id)).toBe("not_found"); // outra empresa
    expect(await service.cancel(c, "nao-e-uuid")).toBe("not_found");
    expect(await service.cancel(c, q.id)).toBe("cancelled");
    expect(await service.status(c, q.id)).toEqual({ status: "cancelled" });
    expect(await service.cancel(c, q.id)).toBe("already_finished");
    expect(await runOnce(async () => answer)).toBe("idle"); // nada para o worker pegar

    for (let i = 0; i < CORE_QUERY_LIMITS.perUser; i++) await service.submit(c, { question: `q${i}` });
    const open = await pool.query<{ id: string }>("SELECT id FROM fmcc_work_item WHERE tenant_id=$1 AND state='queued' LIMIT 1", [c.tenantId]);
    expect(await service.cancel(c, open.rows[0]!.id)).toBe("cancelled");
    await service.submit(c, { question: "cabe de novo" }); // o cancelamento liberou uma vaga

    // cancelada durante a execucao: o resultado que chegar depois nao reescreve o estado
    await clean(); // so a consulta deste trecho pode ser pega pelo worker
    const c2 = ctx("g", "1");
    const run = await service.submit(c2, { question: "cancelar rodando" });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const worker = runOnce(async () => { await gate; return answer; });
    for (let i = 0; i < 100; i++) {
      const s = await pool.query("SELECT state FROM fmcc_work_item WHERE id=$1", [run.id]);
      if (s.rows[0].state === "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(await service.cancel(c2, run.id)).toBe("cancelled");
    release();
    expect(await worker).toBe("lease_lost");
    expect(await service.status(c2, run.id)).toEqual({ status: "cancelled" });
  });
});
