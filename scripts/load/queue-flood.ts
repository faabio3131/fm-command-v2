/**
 * Pior caso de justica (ADR-018): uma empresa joga muitas tarefas de prioridade alta e esta no limite
 * de simultaneas; mede quanto demora para as outras empresas serem atendidas. Uso: DATABASE_URL=... npx tsx scripts/load/queue-flood.ts [flood] [saida.json]
 */
import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { PostgresWorkQueue } from "../../src/infrastructure/core/postgres-work-queue";

const flood = Number(process.argv[2] ?? 50000);
const out = process.argv[3];
const P = "fila-flood-";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
const queue = new PostgresWorkQueue(pool);

async function main() {
  await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id LIKE $1", [`${P}%`]);
  await pool.query(
    `INSERT INTO fmcc_work_item(tenant_id,task_type,priority,locale,payload,idempotency_key,deadline_at)
     SELECT $1,'analysis',90,'pt-BR','{}'::jsonb,'f'||g, now()+interval '1 hour' FROM generate_series(1,$2) g`, [`${P}grande`, flood]);
  for (let i = 0; i < 30; i++) await queue.enqueue({ tenantId: `${P}p${i}`, taskType: "analysis", priority: 10, locale: "pt-BR", payload: {}, idempotencyKey: "x", deadlineInMs: 3_600_000 });
  await pool.query("ANALYZE fmcc_work_item");
  const held = [];
  for (let i = 0; i < 3; i++) held.push(await queue.claim({ workerId: "h", leaseMs: 600_000, maxPerTenant: 3 })); // enche o limite da empresa grande
  const lat: number[] = []; let served = 0;
  for (let i = 0; i < 30; i++) {
    const s = Date.now();
    const it = await queue.claim({ workerId: "o", leaseMs: 60_000, maxPerTenant: 3 });
    lat.push(Date.now() - s);
    if (it && it.tenantId !== `${P}grande`) { served++; await queue.complete(it.id, it.leaseToken, {}); }
  }
  lat.sort((a, b) => a - b);
  const r = { tarefasDaEmpresaGrande: flood, empresasPequenas: 30, atendidasPequenas: served, pegarMs: { p50: lat[15], p95: lat[28], max: lat[29] }, cpus: (await import("node:os")).cpus().length };
  await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id LIKE $1", [`${P}%`]);
  console.log(JSON.stringify(r)); if (out) writeFileSync(out, JSON.stringify(r, null, 2));
}
main().finally(() => pool.end());
