import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@/infrastructure/db/client";
import { PostgresWorkQueue, WorkQueueInputError } from "@/infrastructure/core/postgres-work-queue";
import { PermanentTaskError, processOne, type HandlerRegistry } from "@/application/core/work-worker";
import type { EnqueueInput } from "@/domain/core/work-queue";

const P = "fila-teste-";
const T = (n: string) => `${P}${n}`;
const fast = { baseMs: 5, capMs: 20 };
const queue = new PostgresWorkQueue(pool, fast, () => 0.5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base = (tenant: string, key: string, extra: Partial<EnqueueInput> = {}): EnqueueInput => ({
  tenantId: tenant, taskType: "analysis", locale: "pt-BR", payload: { n: key }, idempotencyKey: key, deadlineInMs: 60_000, ...extra,
});
const opts = (id = "w1", extra: { maxPerTenant?: number } = {}) => ({ workerId: id, leaseMs: 5_000, maxPerTenant: 100, ...extra });
const states = async (prefix = P) =>
  Object.fromEntries((await pool.query("SELECT state, count(*)::int AS n FROM fmcc_work_item WHERE tenant_id LIKE $1 GROUP BY state", [`${prefix}%`])).rows.map((r) => [r.state, r.n]));
async function clean() { await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id LIKE $1", [`${P}%`]); }
beforeAll(clean);
afterAll(async () => { await clean(); });

describe("fila de trabalho no PostgreSQL (ADR-018)", () => {
  it("rejeita entrada invalida", async () => {
    await expect(queue.enqueue(base("", "k"))).rejects.toBeInstanceOf(WorkQueueInputError);
    await expect(queue.enqueue(base(T("v"), "k", { priority: 101 }))).rejects.toThrow("queue.priority_0_to_100");
    await expect(queue.enqueue(base(T("v"), "k", { deadlineInMs: 0 }))).rejects.toThrow("queue.deadline_must_be_future");
    await expect(queue.enqueue(base(T("v"), "k", { maxAttempts: 0 }))).rejects.toThrow("queue.max_attempts_1_to_20");
  });

  it("enfileirar duas vezes a mesma chave nao duplica; outra empresa pode usar a mesma chave", async () => {
    const a = await queue.enqueue(base(T("idem-a"), "same"));
    const b = await queue.enqueue(base(T("idem-a"), "same"));
    const c = await queue.enqueue(base(T("idem-b"), "same"));
    expect(a.inserted).toBe(true);
    expect(b).toEqual({ id: a.id, inserted: false });
    expect(c.inserted).toBe(true);
    expect(c.id).not.toBe(a.id);
  });

  it("entrega por prioridade e depois por ordem de chegada", async () => {
    const t = T("prio");
    await queue.enqueue(base(t, "baixa", { priority: 10 }));
    await queue.enqueue(base(t, "alta-1", { priority: 90 }));
    await queue.enqueue(base(t, "media", { priority: 50 }));
    await queue.enqueue(base(t, "alta-2", { priority: 90 }));
    const order: string[] = [];
    for (let i = 0; i < 4; i++) { const it = await queue.claim(opts()); if (it && it.tenantId === t) { order.push(it.idempotencyKey); await queue.complete(it.id, it.leaseToken, {}); } else if (it) { await queue.complete(it.id, it.leaseToken, {}); i--; } }
    expect(order).toEqual(["alta-1", "alta-2", "media", "baixa"]);
  });

  it("oito workers disputando 60 tarefas: cada tarefa sai exatamente uma vez", async () => {
    const t = T("disputa");
    for (let i = 0; i < 60; i++) await queue.enqueue(base(t, `d${i}`));
    const seen: string[] = [];
    await Promise.all(Array.from({ length: 8 }, async (_, w) => {
      for (;;) {
        const it = await queue.claim(opts(`w${w}`));
        if (!it) return;
        seen.push(it.idempotencyKey);
        await queue.complete(it.id, it.leaseToken, {});
      }
    }));
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  });

  it("respeita o limite de tarefas simultaneas por empresa, sem travar as outras", async () => {
    const big = T("limite-a"), small = T("limite-b");
    for (let i = 0; i < 10; i++) await queue.enqueue(base(big, `l${i}`, { priority: 80 }));
    await queue.enqueue(base(small, "s0", { priority: 10 }));
    const got = (await Promise.all(Array.from({ length: 6 }, (_, w) => queue.claim(opts(`w${w}`, { maxPerTenant: 2 }))))).filter(Boolean);
    const perTenant = (n: string) => got.filter((g) => g!.tenantId === n).length;
    expect(perTenant(big)).toBeLessThanOrEqual(2);
    const again = await queue.claim(opts("w9", { maxPerTenant: 2 }));
    // com a empresa grande no limite, a pequena (prioridade menor) ainda e atendida
    expect([...got, again].some((g) => g?.tenantId === small)).toBe(true);
    for (const g of [...got, again]) if (g) await queue.complete(g.id, g.leaseToken, {});
    // limpa o resto
    for (;;) { const it = await queue.claim(opts()); if (!it) break; await queue.complete(it.id, it.leaseToken, {}); }
  });

  it("worker que morre perde a posse; outro assume e o antigo nao sobrescreve (fencing)", async () => {
    const t = T("queda");
    await queue.enqueue(base(t, "q1"));
    const first = await queue.claim({ workerId: "morre", leaseMs: 60, maxPerTenant: 5 });
    expect(first?.attempt).toBe(1);
    expect(await queue.claim(opts("outro"))).toBeNull(); // posse ainda valida
    await sleep(120);
    const second = await queue.claim(opts("assume"));
    expect(second?.id).toBe(first!.id);
    expect(second?.attempt).toBe(2);
    expect(await queue.complete(first!.id, first!.leaseToken, { de: "antigo" })).toBe(false);
    expect(await queue.fail(first!.id, first!.leaseToken, "x", true)).toBe("lease_lost");
    expect(await queue.complete(second!.id, second!.leaseToken, { de: "novo" })).toBe(true);
    const row = (await pool.query("SELECT state, result FROM fmcc_work_item WHERE id=$1", [first!.id])).rows[0];
    expect(row).toEqual({ state: "succeeded", result: { de: "novo" } });
  });

  it("morte na ultima tentativa fica registrada como dead, nao some e nao roda de novo", async () => {
    const t = T("ultima");
    const { id } = await queue.enqueue(base(t, "u1", { maxAttempts: 1 }));
    await queue.claim({ workerId: "morre", leaseMs: 40, maxPerTenant: 5 });
    await sleep(90);
    expect(await queue.claim(opts())).toBeNull();
    const row = (await pool.query("SELECT state, last_error FROM fmcc_work_item WHERE id=$1", [id])).rows[0];
    expect(row).toEqual({ state: "dead", last_error: "queue.worker_lost_on_last_attempt" });
  });

  it("falha repetivel volta com espera; esgotadas as tentativas vai para dead; erro permanente vai direto", async () => {
    const t = T("repete");
    const { id } = await queue.enqueue(base(t, "r1", { maxAttempts: 3 }));
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i++) {
      let it = await queue.claim(opts());
      for (let k = 0; !it && k < 20; k++) { await sleep(10); it = await queue.claim(opts()); }
      expect(it?.id).toBe(id);
      outcomes.push(await queue.fail(it!.id, it!.leaseToken, "boom", true));
    }
    expect(outcomes).toEqual(["retry_scheduled", "retry_scheduled", "dead"]);
    const p = await queue.enqueue(base(t, "r2"));
    const it = await queue.claim(opts());
    expect(it?.id).toBe(p.id);
    expect(await queue.fail(it!.id, it!.leaseToken, "invalido", false)).toBe("dead");
  });

  it("tarefa que passou do prazo expira e nao e entregue", async () => {
    const t = T("prazo");
    const { id } = await queue.enqueue(base(t, "p1", { deadlineInMs: 30 }));
    await sleep(60);
    expect(await queue.claim(opts())).toBeNull();
    expect(await queue.sweepExpired()).toBeGreaterThanOrEqual(1);
    expect((await pool.query("SELECT state FROM fmcc_work_item WHERE id=$1", [id])).rows[0].state).toBe("expired");
  });

  it("processOne: sucesso, erro permanente e tipo sem executor", async () => {
    const t = T("worker");
    const handlers: HandlerRegistry = {
      analysis: async (item) => { if (item.idempotencyKey === "ruim") throw new PermanentTaskError("dado invalido"); return { ok: true }; },
    };
    await queue.enqueue(base(t, "bom"));
    await queue.enqueue(base(t, "ruim", { priority: 10 }));
    await queue.enqueue(base(t, "sem-executor", { taskType: "synthesis", priority: 5 }));
    const o = { ...opts("w"), handlers };
    const results = [await processOne(queue, o), await processOne(queue, o), await processOne(queue, o)];
    expect(results).toEqual(["succeeded", "dead", "dead"]);
    expect(await processOne(queue, o)).toBe("idle");
  });

  it("PROVA: sob falhas provocadas nenhuma tarefa se perde (300 tarefas, 8 workers, queda, lentidao e erro)", async () => {
    const tenants = Array.from({ length: 6 }, (_, i) => T(`caos-${i}`));
    const N = 300;
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let i = 0; i < N; i++) await queue.enqueue(base(tenants[i % 6]!, `c${i}`, { maxAttempts: 8, priority: Math.floor(rnd() * 100) }));
    const completedTrue = new Map<string, number>();
    const stop = { v: false };
    const worker = async (w: number) => {
      while (!stop.v) {
        await queue.sweepExpired();
        const it = await queue.claim({ workerId: `c${w}`, leaseMs: 80, maxPerTenant: 3 });
        if (!it) { await sleep(10); continue; }
        const dice = rnd();
        if (dice < 0.10) continue;                                   // worker "morre": abandona sem avisar
        if (dice < 0.25) { await queue.fail(it.id, it.leaseToken, "provedor fora", true); continue; } // erro repetivel
        if (dice < 0.30) { await sleep(160); }                       // lento: perde a posse antes de terminar
        if (await queue.complete(it.id, it.leaseToken, { w })) completedTrue.set(it.idempotencyKey, (completedTrue.get(it.idempotencyKey) ?? 0) + 1);
      }
    };
    const workers = Array.from({ length: 8 }, (_, w) => worker(w));
    const t0 = Date.now();
    for (;;) {
      const s = await states(P + "caos-");
      const open = (s.queued ?? 0) + (s.running ?? 0);
      if (open === 0 || Date.now() - t0 > 90_000) break;
      await sleep(100);
    }
    stop.v = true;
    await Promise.all(workers);
    const s = await states(P + "caos-");
    const total = (Object.values(s) as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(N);                       // nenhuma sumiu
    expect(s.queued ?? 0).toBe(0);                // nenhuma ficou esquecida
    expect(s.running ?? 0).toBe(0);
    expect(s.succeeded ?? 0).toBe(completedTrue.size); // sucesso registrado == conclusoes aceitas
    for (const n of completedTrue.values()) expect(n).toBe(1); // nenhuma concluida duas vezes
    expect((s.succeeded ?? 0) + (s.dead ?? 0) + (s.expired ?? 0)).toBe(N);
    if (process.env.QUEUE_TEST_VERBOSE) (await import("node:fs")).writeFileSync(process.env.QUEUE_TEST_VERBOSE, JSON.stringify([s, (await pool.query("SELECT count(*)::int n, max(attempt) m FROM fmcc_work_item WHERE tenant_id LIKE $1 AND attempt>1", [P + "caos-%"])).rows[0]]));
    expect(s.succeeded ?? 0).toBeGreaterThan(N * 0.9); // com 8 tentativas quase todas terminam bem
  }, 120_000);
});
