import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ClaimOptions, EnqueueInput, FailOutcome, RetryPolicy, WorkItem, WorkQueue } from "@/domain/core/work-queue";
import { DEFAULT_RETRY, retryDelayMs, WORK_TYPES, type WorkType } from "@/domain/core/work-queue";


const MAX_CLAIM_SCAN = 25;

export class WorkQueueInputError extends Error {
  constructor(code: string) { super(code); this.name = "WorkQueueInputError"; }
}

function validateEnqueue(i: EnqueueInput): void {
  if (!i.tenantId || i.tenantId.length > 128) throw new WorkQueueInputError("queue.tenant_invalid");
  if (!WORK_TYPES.includes(i.taskType)) throw new WorkQueueInputError("queue.type_unknown");
  const p = i.priority ?? 50;
  if (!Number.isInteger(p) || p < 0 || p > 100) throw new WorkQueueInputError("queue.priority_0_to_100");
  if (!i.idempotencyKey || i.idempotencyKey.length > 256) throw new WorkQueueInputError("queue.idempotency_key_invalid");
  const m = i.maxAttempts ?? 3;
  if (!Number.isInteger(m) || m < 1 || m > 20) throw new WorkQueueInputError("queue.max_attempts_1_to_20");
  if (!Number.isFinite(i.deadlineInMs) || i.deadlineInMs <= 0) throw new WorkQueueInputError("queue.deadline_must_be_future");
}

interface Candidate { id: string; tenant_id: string; attempt: number; max_attempts: number }

interface ClaimRow {
  id: string; tenant_id: string; unit_id: string | null; task_type: WorkType; priority: number; locale: string;
  payload: Record<string, unknown>; idempotency_key: string; attempt: number; max_attempts: number;
  deadline_at: Date; lease_token: string;
}

/**
 * Fila no PostgreSQL: SKIP LOCKED para varios workers sem pegar a mesma tarefa, posse por prazo
 * (lease) para recuperar tarefa de worker que morreu, limite por empresa e repeticao com espera.
 * Quem termina uma tarefa precisa provar que ainda e o dono (leaseToken): worker atrasado nao sobrescreve.
 */
export class PostgresWorkQueue implements WorkQueue {
  constructor(
    private readonly pool: Pick<Pool, "connect" | "query">,
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
    private readonly random: () => number = Math.random,
  ) {}

  async enqueue(input: EnqueueInput): Promise<{ id: string; inserted: boolean }> {
    validateEnqueue(input);
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO fmcc_work_item(tenant_id,unit_id,task_type,priority,locale,payload,idempotency_key,max_attempts,deadline_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8, now() + ($9::int * interval '1 millisecond'))
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`,
      [input.tenantId, input.unitId ?? null, input.taskType, input.priority ?? 50, input.locale,
        JSON.stringify(input.payload), input.idempotencyKey, input.maxAttempts ?? 3, Math.round(input.deadlineInMs)],
    );
    if (r.rows[0]) return { id: r.rows[0].id, inserted: true };
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id FROM fmcc_work_item WHERE tenant_id=$1 AND idempotency_key=$2", [input.tenantId, input.idempotencyKey]);
    return { id: existing.rows[0]!.id, inserted: false };
  }

  async claim(options: ClaimOptions): Promise<WorkItem | null> {
    if (!Number.isInteger(options.maxPerTenant) || options.maxPerTenant < 1) throw new WorkQueueInputError("queue.max_per_tenant_invalid");
    if (!Number.isFinite(options.leaseMs) || options.leaseMs <= 0) throw new WorkQueueInputError("queue.lease_invalid");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // 1) Posse vencida (worker que morreu): indice proprio, conjunto pequeno.
      for (let scan = 0; scan < MAX_CLAIM_SCAN; scan++) {
        const orphan = await client.query<Candidate>(
          `SELECT id, tenant_id, attempt, max_attempts FROM fmcc_work_item
           WHERE state='running' AND lease_until < now() AND deadline_at > now()
           ORDER BY lease_until LIMIT 1 FOR UPDATE SKIP LOCKED`);
        const row = orphan.rows[0];
        if (!row) break;
        if (row.attempt >= row.max_attempts) {
          // Worker morreu na ultima tentativa: registra, nao some e nao roda de novo.
          await client.query(
            `UPDATE fmcc_work_item SET state='dead', lease_token=NULL, lease_until=NULL, finished_at=now(), updated_at=now(),
               last_error='queue.worker_lost_on_last_attempt' WHERE id=$1`, [row.id]);
          continue;
        }
        const taken = await this.take(client, row, options);
        if (taken) { await client.query("COMMIT"); return taken; }
        break;
      }
      // 2) Tarefas na fila: so a primeira de cada empresa (nao varre a fila toda) e so de empresas com folga.
      const heads = await client.query<Candidate>(
        `WITH RECURSIVE tenants(tenant_id) AS (
           (SELECT tenant_id FROM fmcc_work_item WHERE state='queued' ORDER BY tenant_id LIMIT 1)
           UNION ALL
           SELECT (SELECT w.tenant_id FROM fmcc_work_item w WHERE w.state='queued' AND w.tenant_id > t.tenant_id
                   ORDER BY w.tenant_id LIMIT 1) FROM tenants t WHERE t.tenant_id IS NOT NULL
         ), busy AS (
           SELECT tenant_id FROM fmcc_work_item WHERE state='running' AND lease_until >= now()
           GROUP BY tenant_id HAVING count(*) >= $1
         )
         SELECT c.id, c.tenant_id, c.attempt, c.max_attempts
         FROM tenants t
         JOIN LATERAL (
           SELECT w.id, w.tenant_id, w.attempt, w.max_attempts, w.priority, w.run_after, w.created_at
           FROM fmcc_work_item w
           WHERE w.state='queued' AND w.tenant_id = t.tenant_id AND w.run_after <= now() AND w.deadline_at > now()
           ORDER BY w.priority DESC, w.run_after, w.created_at LIMIT 1
         ) c ON true
         WHERE t.tenant_id IS NOT NULL AND t.tenant_id NOT IN (SELECT tenant_id FROM busy)
         ORDER BY c.priority DESC, c.run_after, c.created_at
         LIMIT $2`, [options.maxPerTenant, MAX_CLAIM_SCAN]);
      for (const head of heads.rows) {
        // Confirma que ainda esta na fila e que nenhum outro worker a esta pegando agora.
        const lock = await client.query<Candidate>(
          `SELECT id, tenant_id, attempt, max_attempts FROM fmcc_work_item
           WHERE id=$1 AND state='queued' FOR UPDATE SKIP LOCKED`, [head.id]);
        const row = lock.rows[0];
        if (!row) continue;
        const taken = await this.take(client, row, options);
        if (taken) { await client.query("COMMIT"); return taken; }
      }
      await client.query("COMMIT");
      return null;
    } catch (e) {
      await rollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Decide uma empresa por vez (trava sem espera: nunca ha deadlock) e confere o limite antes de dar a posse. */
  private async take(client: PoolClient, row: Candidate, options: ClaimOptions): Promise<WorkItem | null> {
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok", [row.tenant_id]);
    if (!lock.rows[0]!.ok) return null;
    const running = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM fmcc_work_item WHERE tenant_id=$1 AND state='running' AND lease_until >= now() AND id <> $2`,
      [row.tenant_id, row.id]);
    if (Number(running.rows[0]!.n) >= options.maxPerTenant) return null;
    const token = randomUUID();
    const upd = await client.query<ClaimRow>(
      `UPDATE fmcc_work_item SET state='running', attempt=attempt+1, lease_token=$2,
         lease_until = now() + ($3::int * interval '1 millisecond'), worker_id=$4, updated_at=now()
       WHERE id=$1
       RETURNING id, tenant_id, unit_id, task_type, priority, locale, payload, idempotency_key, attempt, max_attempts, deadline_at, lease_token`,
      [row.id, token, Math.round(options.leaseMs), options.workerId]);
    const u = upd.rows[0]!;
    return {
      id: u.id, tenantId: u.tenant_id, unitId: u.unit_id, taskType: u.task_type, priority: u.priority, locale: u.locale,
      payload: u.payload, idempotencyKey: u.idempotency_key, attempt: u.attempt, maxAttempts: u.max_attempts,
      deadlineAt: u.deadline_at, leaseToken: u.lease_token,
    };
  }

  async heartbeat(id: string, leaseToken: string, leaseMs: number): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE fmcc_work_item SET lease_until = now() + ($3::int * interval '1 millisecond'), updated_at=now()
       WHERE id=$1 AND lease_token=$2 AND state='running'`, [id, leaseToken, Math.round(leaseMs)]);
    return r.rowCount === 1;
  }

  async complete(id: string, leaseToken: string, result: Record<string, unknown>): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE fmcc_work_item SET state='succeeded', result=$3::jsonb, lease_token=NULL, lease_until=NULL,
         finished_at=now(), updated_at=now(), last_error=NULL
       WHERE id=$1 AND lease_token=$2 AND state='running'`, [id, leaseToken, JSON.stringify(result)]);
    return r.rowCount === 1;
  }

  async fail(id: string, leaseToken: string, error: string, retryable: boolean): Promise<FailOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query<{ attempt: number; max_attempts: number; deadline_at: Date; now: Date }>(
        `SELECT attempt, max_attempts, deadline_at, now() AS now FROM fmcc_work_item
         WHERE id=$1 AND lease_token=$2 AND state='running' FOR UPDATE`, [id, leaseToken]);
      const row = cur.rows[0];
      if (!row) { await client.query("COMMIT"); return "lease_lost"; }
      const msg = error.slice(0, 500);
      const delay = retryDelayMs(row.attempt, this.retry, this.random());
      const nextAt = row.now.getTime() + delay;
      let outcome: FailOutcome;
      if (!retryable || row.attempt >= row.max_attempts) outcome = "dead";
      else if (nextAt >= row.deadline_at.getTime()) outcome = "expired";
      else outcome = "retry_scheduled";
      if (outcome === "retry_scheduled") {
        await client.query(
          `UPDATE fmcc_work_item SET state='queued', lease_token=NULL, lease_until=NULL, worker_id=NULL, last_error=$2,
             run_after = now() + ($3::int * interval '1 millisecond'), updated_at=now() WHERE id=$1`, [id, msg, delay]);
      } else {
        await client.query(
          `UPDATE fmcc_work_item SET state=$2, lease_token=NULL, lease_until=NULL, last_error=$3, finished_at=now(), updated_at=now() WHERE id=$1`,
          [id, outcome, msg]);
      }
      await client.query("COMMIT");
      return outcome;
    } catch (e) {
      await rollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  async sweepExpired(): Promise<number> {
    const r = await this.pool.query(
      `UPDATE fmcc_work_item SET state='expired', lease_token=NULL, lease_until=NULL, finished_at=now(), updated_at=now(),
         last_error=COALESCE(last_error,'queue.deadline_passed')
       WHERE deadline_at <= now() AND (state='queued' OR (state='running' AND lease_until < now()))`);
    return r.rowCount ?? 0;
  }
}

async function rollback(client: PoolClient): Promise<void> {
  try { await client.query("ROLLBACK"); } catch { /* conexao ja caiu */ }
}
