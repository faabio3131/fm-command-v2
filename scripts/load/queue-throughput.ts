/**
 * Mede quantas tarefas por segundo a fila no PostgreSQL entrega (ADR-018), com tarefa que nao faz nada.
 * Uso: DATABASE_URL=... npx tsx scripts/load/queue-throughput.ts [total] [workers] [saida.json]
 * Mede so a fila (entrar, ser pega, ser concluida); o trabalho real (IA) vem por cima disso.
 */
import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { PostgresWorkQueue } from "../../src/infrastructure/core/postgres-work-queue";

const total = Number(process.argv[2] ?? 5000);
const workers = Number(process.argv[3] ?? 8);
const out = process.argv[4];
const P = "fila-carga-";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: workers + 4 });
const queue = new PostgresWorkQueue(pool);

async function main() {
  await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id LIKE $1", [`${P}%`]);
  const t0 = Date.now();
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      await queue.enqueue({ tenantId: `${P}${i % 20}`, taskType: "analysis", locale: "pt-BR", payload: { i }, idempotencyKey: `k${i}`, deadlineInMs: 600_000 });
    }
  }));
  const enqueueMs = Date.now() - t0;
  const t1 = Date.now();
  let done = 0;
  const lat: number[] = [];
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    for (;;) {
      const s = Date.now();
      const it = await queue.claim({ workerId: `w${w}`, leaseMs: 30_000, maxPerTenant: 1000 });
      if (!it) return;
      await queue.complete(it.id, it.leaseToken, {});
      lat.push(Date.now() - s);
      done++;
    }
  }));
  const claimMs = Date.now() - t1;
  lat.sort((a, b) => a - b);
  const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] ?? 0;
  const result = {
    total, workers, tenants: 20, done,
    enfileirarPorSegundo: Math.round(total / (enqueueMs / 1000)),
    pegarEConcluirPorSegundo: Math.round(done / (claimMs / 1000)),
    pegarEConcluirMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99) },
    cpus: (await import("node:os")).cpus().length, node: process.version,
  };
  await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id LIKE $1", [`${P}%`]);
  console.log(JSON.stringify(result));
  if (out) writeFileSync(out, JSON.stringify(result, null, 2));
}
main().finally(() => pool.end());
