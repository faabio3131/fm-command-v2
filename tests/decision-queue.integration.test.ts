import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { pool } from "@/infrastructure/db/client";
import { PostgresAiConfig } from "@/infrastructure/core/postgres-ai-config";
import { PostgresWorkQueue } from "@/infrastructure/core/postgres-work-queue";
import { OpenAiCompatibleProvider } from "@/infrastructure/core/openai-compatible-provider";
import { ProviderRouter } from "@/application/core/provider-router";
import { createDecisionHandler } from "@/application/core/decision-handler";
import { processOne } from "@/application/core/work-worker";

const T = "decisao-teste-";
let reply = '{"chosen":"b","probability":0.93}';
let server: Server; let url = "";
const queue = new PostgresWorkQueue(pool, { baseMs: 5, capMs: 10 }, () => 0.5);
const router = new ProviderRouter({
  config: new PostgresAiConfig(pool), configTtlMs: 0, random: () => 0,
  makeProvider: (c) => new OpenAiCompatibleProvider(c, { AI_KEY_DEC: "chave-so-no-ambiente", FMCC_AI_ALLOW_LOCAL_PROVIDERS: "1" }),
});
const handlers = { decision: createDecisionHandler(router) };
const run = () => processOne(queue, { workerId: "t", leaseMs: 5000, maxPerTenant: 5, handlers });
const req = { kind: "choice", question: "Qual métrica?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
const submit = (key: string, payload: Record<string, unknown> = req, maxAttempts = 3) =>
  queue.enqueue({ tenantId: `${T}1`, taskType: "decision", locale: "pt-BR", payload, idempotencyKey: key, maxAttempts, deadlineInMs: 60_000 });

async function clean() {
  await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id LIKE $1", [`${T}%`]);
  await pool.query("DELETE FROM fmcc_ai_usage WHERE tenant_id LIKE $1", [`${T}%`]);
  await pool.query("DELETE FROM fmcc_ai_route WHERE provider_id = 'dec-fast'");
  await pool.query("DELETE FROM fmcc_ai_provider WHERE id = 'dec-fast'");
}
beforeAll(async () => {
  process.env.FMCC_AI_ALLOW_LOCAL_PROVIDERS = "1";
  server = createServer((r, res) => { r.resume(); r.on("end", () => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: "fast-m", choices: [{ message: { content: reply } }], usage: { prompt_tokens: 120, completion_tokens: 20 } }))); }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await clean();
  await pool.query(`INSERT INTO fmcc_ai_provider(id,base_url,model,secret_ref,enabled,timeout_ms,currency,input_minor_per_million,output_minor_per_million) VALUES('dec-fast',$1,'fast-m','env://AI_KEY_DEC',true,5000,'USD',25,125)`, [url]);
  await pool.query(`INSERT INTO fmcc_ai_route(task_type,tenant_id,provider_id,role,weight,max_concurrent) VALUES('decision',NULL,'dec-fast','primary',1,8)`);
  reply = '{"chosen":"b","probability":0.93}';
});
afterAll(async () => { await clean(); server.close(); });

describe("decisao rapida pela fila e pela politica do banco", () => {
  it("decide, grava o uso exato e nao pede ajuda quando a confianca e alta", async () => {
    const t = await submit("k1");
    expect(await run()).toBe("succeeded");
    const r = await pool.query("SELECT result FROM fmcc_work_item WHERE id=$1", [t.id]);
    expect(r.rows[0].result).toMatchObject({ decision: { kind: "choice", chosen: "b" }, needsHuman: false, tokensIn: 120, tokensOut: 20, providerId: "dec-fast" });
    // 120*25 + 20*125 = 5500 micro-centavos, exatos
    expect(Number(r.rows[0].result.costMicroMinor)).toBe(5500);
    const u = await pool.query("SELECT count(*)::int n FROM fmcc_ai_usage WHERE task_id=$1", [t.id]);
    expect(u.rows[0].n).toBe(1);
  });

  it("confianca baixa vem marcada para escalar", async () => {
    reply = '{"chosen":"a","probability":0.45}';
    const t = await submit("k2");
    expect(await run()).toBe("succeeded");
    const r = await pool.query("SELECT result FROM fmcc_work_item WHERE id=$1", [t.id]);
    expect(r.rows[0].result).toMatchObject({ needsHuman: true });
  });

  it("opcao inventada pelo modelo nunca vira decisao: repete e termina em dead", async () => {
    reply = '{"chosen":"zzz","probability":0.99}';
    const t = await submit("k3", req, 2);
    const first = await run();
    expect(first).toBe("retry_scheduled");
    await new Promise((r) => setTimeout(r, 30));
    expect(await run()).toBe("dead");
    const r = await pool.query("SELECT state, result FROM fmcc_work_item WHERE id=$1", [t.id]);
    expect(r.rows[0].state).toBe("dead"); expect(r.rows[0].result).toBeNull();
  });

  it("pedido invalido vai direto para dead, sem chamar o provedor", async () => {
    const t = await submit("k4", { kind: "choice", question: "so uma", options: [{ id: "a", label: "A" }] });
    expect(await run()).toBe("dead");
    const u = await pool.query("SELECT count(*)::int n FROM fmcc_ai_usage WHERE task_id=$1", [t.id]);
    expect(u.rows[0].n).toBe(0);
  });
});
