import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { pool } from "@/infrastructure/db/client";
import { PostgresAiConfig } from "@/infrastructure/core/postgres-ai-config";
import { PostgresWorkQueue } from "@/infrastructure/core/postgres-work-queue";
import { OpenAiCompatibleProvider } from "@/infrastructure/core/openai-compatible-provider";
import { ProviderRouter } from "@/application/core/provider-router";
import { createAiTaskHandler } from "@/application/core/ai-task-handler";
import { processOne } from "@/application/core/work-worker";

const TP = "ia-teste-";
const tenant = (n: string) => `${TP}${n}`;
type Beh = { status: number; usage?: boolean };
const behavior: Record<string, () => Beh> = {};
const hits: Record<string, number> = {};
const servers: Server[] = [];
const urls: Record<string, string> = {};

async function startProvider(name: string) {
  const s = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      hits[name] = (hits[name] ?? 0) + 1;
      const b = behavior[name]!();
      if (b.status !== 200) return void res.writeHead(b.status).end("x");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: `${name}-m`, choices: [{ message: { content: `resposta de ${name}` } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
    });
  }).listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  servers.push(s);
  urls[name] = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

async function clean() {
  await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id LIKE $1", [`${TP}%`]);
  await pool.query("DELETE FROM fmcc_ai_usage WHERE tenant_id LIKE $1", [`${TP}%`]);
  await pool.query("DELETE FROM fmcc_ai_tenant_policy WHERE tenant_id LIKE $1", [`${TP}%`]);
  await pool.query("DELETE FROM fmcc_ai_route WHERE provider_id LIKE 'it-%'");
  await pool.query("DELETE FROM fmcc_ai_provider WHERE id LIKE 'it-%'");
}
async function addProvider(id: string, name: string, enabled = true) {
  await pool.query(
    `INSERT INTO fmcc_ai_provider(id,base_url,model,secret_ref,enabled,timeout_ms,currency,input_minor_per_million,output_minor_per_million)
     VALUES($1,$2,$3,'env://AI_KEY_IT',$4,5000,'USD',300,1500)`, [id, urls[name], `${name}-m`, enabled]);
}
async function addRoute(provider: string, role: "primary" | "reserve", tenantId: string | null = null, weight = 1) {
  await pool.query(`INSERT INTO fmcc_ai_route(task_type,tenant_id,provider_id,role,weight,max_concurrent) VALUES('analysis',$1,$2,$3,$4,8)`, [tenantId, provider, role, weight]);
}

const fastRetry = { baseMs: 5, capMs: 20 };
const queue = new PostgresWorkQueue(pool, fastRetry, () => 0.5);
const makeRouter = (extra: { failureThreshold?: number } = {}) => new ProviderRouter({
  config: new PostgresAiConfig(pool), configTtlMs: 0,
  makeProvider: (c) => new OpenAiCompatibleProvider(c, { AI_KEY_IT: "chave-so-no-ambiente", FMCC_AI_ALLOW_LOCAL_PROVIDERS: "1" }),
  random: () => 0, ...extra,
});
const enqueue = (t: string, key: string, maxAttempts = 5) => queue.enqueue({
  tenantId: t, taskType: "analysis", locale: "pt-BR", payload: { system: "Voce e um analista.", user: `pergunta ${key}`, maxTokens: 100 },
  idempotencyKey: key, maxAttempts, deadlineInMs: 120_000,
});
async function drain(router: ProviderRouter, workers = 4) {
  const handlers = { analysis: createAiTaskHandler(router) };
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    for (let idle = 0; idle < 30;) {
      const o = await processOne(queue, { workerId: `w${w}`, leaseMs: 5000, maxPerTenant: 50, handlers });
      if (o === "idle") { idle++; await new Promise((r) => setTimeout(r, 20)); const left = await pool.query("SELECT 1 FROM fmcc_work_item WHERE tenant_id LIKE $1 AND state IN ('queued','running') LIMIT 1", [`${TP}%`]); if (left.rowCount === 0) return; } else idle = 0;
    }
  }));
}
const stateOf = async (t: string) => (await pool.query("SELECT state,result,last_error FROM fmcc_work_item WHERE tenant_id=$1 ORDER BY created_at", [t])).rows;

beforeAll(async () => { process.env.FMCC_AI_ALLOW_LOCAL_PROVIDERS = "1"; for (const n of ["a", "b", "d"]) await startProvider(n); });
afterAll(async () => { await clean(); for (const s of servers) { s.closeAllConnections(); s.close(); } });
beforeEach(async () => {
  await clean();
  for (const k of Object.keys(hits)) hits[k] = 0;
  for (const n of ["a", "b", "d"]) behavior[n] = () => ({ status: 200 });
});

describe("provedores de IA com banco e fila (ADR-017 + ADR-018)", () => {
  it("gravar o uso da mesma chamada duas vezes nao duplica; nova tentativa e nova chamada paga", async () => {
    const store = new PostgresAiConfig(pool);
    const u = { tenantId: tenant("uso"), unitId: null, taskId: "tarefa-1", attempt: 1, taskType: "analysis" as const, providerId: "it-a", model: "m", tokensIn: 1, tokensOut: 1, estimated: false, costMicroMinor: 10, currency: "USD", occurredAt: new Date() };
    await store.recordUsage(u); await store.recordUsage(u);
    await store.recordUsage({ ...u, attempt: 2 });
    expect((await pool.query("SELECT count(*)::int n FROM fmcc_ai_usage WHERE tenant_id=$1", [tenant("uso")])).rows[0].n).toBe(2);
  });

  it("o banco recusa chave no lugar da referencia e endereco/moeda invalidos", async () => {
    await expect(pool.query(`INSERT INTO fmcc_ai_provider(id,base_url,model,secret_ref,currency) VALUES('it-x','https://a.com','m','sk-abc123','USD')`)).rejects.toThrow(/fmcc_ai_provider_secret_ck/);
    await expect(pool.query(`INSERT INTO fmcc_ai_provider(id,base_url,model,secret_ref,currency) VALUES('it-x','https://a.com','m','env://AI_KEY_OK','usd')`)).rejects.toThrow(/fmcc_ai_provider_currency_ck/);
    await expect(pool.query(`INSERT INTO fmcc_ai_provider(id,base_url,model,secret_ref,currency) VALUES('it-x','https://a.com','m','env://DATABASE_URL','USD')`)).rejects.toThrow(/fmcc_ai_provider_secret_ck/);
    await expect(pool.query(`INSERT INTO fmcc_ai_route(task_type,provider_id,role) VALUES('analysis','nao-existe','primary')`)).rejects.toThrow();
  });

  it("principal fora do ar: a tarefa termina no reserva e o uso e o custo ficam gravados", async () => {
    await addProvider("it-a", "a"); await addProvider("it-b", "b");
    await addRoute("it-a", "primary"); await addRoute("it-b", "reserve");
    behavior.a = () => ({ status: 503 });
    const t = tenant("reserva");
    await enqueue(t, "q1");
    await drain(makeRouter());
    const [row] = await stateOf(t);
    expect(row.state).toBe("succeeded");
    expect(row.result).toMatchObject({ providerId: "it-b", role: "reserve", attempted: ["it-a", "it-b"], costMicroMinor: 1000 * 300 + 500 * 1500 });
    const usage = (await pool.query("SELECT provider_id,tokens_in::int,tokens_out::int,cost_micro_minor::int,currency,estimated FROM fmcc_ai_usage WHERE tenant_id=$1", [t])).rows;
    expect(usage).toEqual([{ provider_id: "it-b", tokens_in: 1000, tokens_out: 500, cost_micro_minor: 1_050_000, currency: "USD", estimated: false }]);
  });

  it("cliente com provedor dedicado usa so o dele; os demais usam o padrao", async () => {
    await addProvider("it-a", "a"); await addProvider("it-d", "d");
    await addRoute("it-a", "primary"); await addRoute("it-d", "primary", tenant("vip"));
    await enqueue(tenant("vip"), "v1"); await enqueue(tenant("comum"), "c1");
    await drain(makeRouter());
    expect((await stateOf(tenant("vip")))[0].result.providerId).toBe("it-d");
    expect((await stateOf(tenant("comum")))[0].result.providerId).toBe("it-a");
    expect(hits.d).toBe(1); expect(hits.a).toBe(1);
  });

  it("lista de provedores permitidos: o fora da lista nao recebe nem uma chamada; sem permitido a tarefa falha com aviso", async () => {
    await addProvider("it-a", "a"); await addProvider("it-b", "b");
    await addRoute("it-a", "primary"); await addRoute("it-b", "reserve");
    const t = tenant("restrito");
    await pool.query("INSERT INTO fmcc_ai_tenant_policy(tenant_id,allowed_providers) VALUES($1,$2)", [t, ["it-b"]]);
    await enqueue(t, "r1");
    await drain(makeRouter());
    expect((await stateOf(t))[0].result.providerId).toBe("it-b");
    expect(hits.a ?? 0).toBe(0);
    const t2 = tenant("sem-permitido");
    await pool.query("INSERT INTO fmcc_ai_tenant_policy(tenant_id,allowed_providers) VALUES($1,$2)", [t2, ["it-nenhum"]]);
    await enqueue(t2, "r2", 2);
    await drain(makeRouter());
    const [row] = await stateOf(t2);
    expect(row.state).toBe("dead");
    expect(row.last_error).toContain("ai.no_provider_available");
    expect(hits.a ?? 0).toBe(0);
  });

  it("provedor desabilitado ou editado no banco vale na hora, sem reiniciar", async () => {
    await addProvider("it-a", "a"); await addProvider("it-b", "b", false);
    await addRoute("it-a", "primary"); await addRoute("it-b", "primary");
    const router = makeRouter();
    await enqueue(tenant("cfg"), "k1"); await drain(router);
    expect((await stateOf(tenant("cfg")))[0].result.providerId).toBe("it-a");
    await pool.query("UPDATE fmcc_ai_provider SET enabled=true WHERE id='it-b'");
    await pool.query("UPDATE fmcc_ai_provider SET enabled=false WHERE id='it-a'");
    await enqueue(tenant("cfg"), "k2"); await drain(router);
    expect((await stateOf(tenant("cfg"))).map((r) => r.result.providerId)).toEqual(["it-a", "it-b"]);
  });

  it("payload invalido vai direto para dead, sem chamar provedor", async () => {
    await addProvider("it-a", "a"); await addRoute("it-a", "primary");
    await queue.enqueue({ tenantId: tenant("ruim"), taskType: "analysis", locale: "pt-BR", payload: { user: "sem system" }, idempotencyKey: "z", deadlineInMs: 60_000 });
    await drain(makeRouter());
    expect((await stateOf(tenant("ruim")))[0]).toMatchObject({ state: "dead", last_error: expect.stringContaining("ai.task_payload_invalid") });
    expect(hits.a ?? 0).toBe(0);
  });

  it("PROVA: 150 tarefas com dois provedores instaveis, nenhuma se perde e todas as concluidas tem uso gravado", async () => {
    await addProvider("it-a", "a"); await addProvider("it-b", "b");
    await addRoute("it-a", "primary"); await addRoute("it-b", "reserve");
    let n = 0;
    behavior.a = () => ({ status: ++n % 10 < 4 ? 503 : 200 }); // 40% de falha
    let m = 0;
    behavior.b = () => ({ status: ++m % 10 === 0 ? 429 : 200 }); // 10% de limite
    const N = 150;
    for (let i = 0; i < N; i++) await enqueue(tenant(`caos-${i % 5}`), `c${i}`, 8);
    await drain(makeRouter({ failureThreshold: 1000 }), 6);
    const st = Object.fromEntries((await pool.query("SELECT state,count(*)::int n FROM fmcc_work_item WHERE tenant_id LIKE $1 GROUP BY state", [`${TP}caos-%`])).rows.map((r) => [r.state, r.n]));
    const total = (Object.values(st) as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(N);
    expect((st.queued ?? 0) + (st.running ?? 0)).toBe(0);
    expect(st.succeeded ?? 0).toBeGreaterThan(N * 0.95);
    const noUsage = await pool.query(
      `SELECT count(*)::int n FROM fmcc_work_item w WHERE w.tenant_id LIKE $1 AND w.state='succeeded'
         AND NOT EXISTS (SELECT 1 FROM fmcc_ai_usage u WHERE u.task_id = w.id::text)`, [`${TP}caos-%`]);
    expect(noUsage.rows[0].n).toBe(0);
  }, 60_000);
});
