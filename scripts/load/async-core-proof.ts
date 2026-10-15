/**
 * Prova ponta a ponta do Core assíncrono (ADR-016/017/018) com processos Node reais (next start):
 * processo de OPERAÇÃO (enfileira e consulta) + processo de IA (worker), provedores simulados e política salva no banco.
 * Pré-requisito: `next build` feito e banco de teste migrado.
 * Uso: DATABASE_URL=... BETTER_AUTH_SECRET=... npx tsx scripts/load/async-core-proof.ts [saida.json]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { Pool } from "pg";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const PORT = { op: 3211, ai: 3212 } as const;
const T = `prova-assinc-${Date.now()}`;

// ---- provedores simulados (compatíveis com /v1/chat/completions) ----
interface Sim { server: Server; url: string; mode: { fail: boolean }; hits: { n: number } }
async function sim(name: string): Promise<Sim> {
  const mode = { fail: false }; const hits = { n: 0 };
  const server = createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", async () => {
      hits.n++;
      if (mode.fail) return void res.writeHead(503).end("fora");
      let content = `Resposta simulada de ${name}.`;
      try {
        const m = JSON.parse(body).messages as Array<{ role: string; content: string }>;
        if ((m[0]?.content ?? "").includes("planejador")) {
          const id = (JSON.parse(m[1]!.content).metricCatalog?.[0]?.metricId as string | undefined);
          content = JSON.stringify({ metricIds: id ? [id] : [], productSlugs: [] });
          await sleep(400);
        } else await sleep(800);
      } catch { /* resposta padrão */ }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: `${name}-m`, choices: [{ message: { content } }], usage: { prompt_tokens: 1200, completion_tokens: 300 } }));
    });
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, mode, hits };
}

// ---- processos ----
interface Proc { child: ChildProcess; port: number }
const baseEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", AI_KEY_PROOF: "chave-simulada-so-no-ambiente", FMCC_AI_ALLOW_LOCAL_PROVIDERS: "1" };
function start(port: number, extra: Record<string, string>): Proc {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...baseEnv, BETTER_AUTH_URL: `http://localhost:${port}`, ...extra }, stdio: "ignore" });
  child.on("error", () => {});
  return { child, port };
}
async function waitUp(p: Proc) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${p.port}/api/health`)).ok) return; } catch { /* subindo */ } await sleep(500); }
  throw new Error(`porta ${p.port} nao subiu`);
}
async function stop(p: Proc | undefined, signal: NodeJS.Signals = "SIGTERM") {
  if (!p || p.child.exitCode !== null) return;
  const done = new Promise((r) => p.child.once("exit", r));
  p.child.kill(signal);
  await Promise.race([done, sleep(8_000)]);
  if (p.child.exitCode === null) { p.child.kill("SIGKILL"); await Promise.race([done, sleep(3_000)]); }
}

async function session(label: string): Promise<string> {
  const origin = `http://localhost:${PORT.op}`;
  const h = { "content-type": "application/json", origin };
  const up = await fetch(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: h, body: JSON.stringify({ name: label, email: `${label}-${Date.now()}@teste.local`, password: "senha-de-teste-123456" }) });
  if (!up.ok) throw new Error("sign-up falhou");
  const jar = new Map<string, string>();
  const eat = (r: Response) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv!.indexOf("="); jar.set(kv!.slice(0, i), kv!.slice(i + 1)); } };
  eat(up);
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const org = await fetch(`${origin}/api/auth/organization/create`, { method: "POST", headers: { ...h, cookie: cookie() }, body: JSON.stringify({ name: `Empresa ${label}`, slug: `${T}-${label}` }) });
  if (!org.ok) throw new Error("organizacao falhou");
  eat(org);
  return cookie();
}

const api = (cookie: string, path: string, init: RequestInit = {}, port: number = PORT.op) =>
  fetch(`http://localhost:${port}${path}`, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers as Record<string, string> | undefined) } });
async function ask(cookie: string, question = "O que precisa da minha atenção?") {
  const t0 = performance.now();
  const r = await api(cookie, "/api/core/query", { method: "POST", body: JSON.stringify({ question }) });
  const body = await r.json() as { id?: string; error?: string };
  return { status: r.status, ms: Math.round(performance.now() - t0), id: body.id, error: body.error };
}
async function wait(cookie: string, id: string, maxMs = 60_000) {
  const t0 = performance.now(); const seen = new Set<string>(); let last: { status?: string; error?: string; answer?: { answer?: string } } = {};
  while (performance.now() - t0 < maxMs) {
    const r = await api(cookie, `/api/core/query/${id}`);
    last = await r.json() as typeof last; seen.add(last.status ?? String(r.status));
    if (last.status === "succeeded" || last.status === "failed") break;
    await sleep(300);
  }
  return { final: last.status, error: last.error, answerChars: last.answer?.answer?.length ?? 0, seen: [...seen], totalMs: Math.round(performance.now() - t0) };
}
async function probe(ms: number) {
  const s: number[] = []; let bad = 0; const end = performance.now() + ms;
  while (performance.now() < end) { const t = performance.now(); try { const r = await fetch(`http://localhost:${PORT.op}/api/ready`, { signal: AbortSignal.timeout(5000) }); if (r.status !== 200) bad++; } catch { bad++; } s.push(performance.now() - t); await sleep(50); }
  s.sort((a, b) => a - b);
  return { total: s.length, falhas: bad, p50: Math.round(s[Math.floor(s.length * 0.5)] ?? 0), p95: Math.round(s[Math.floor(s.length * 0.95)] ?? 0) };
}

async function main() {
  const out = process.argv[2] ?? "docs/medicoes/etapa-6b-resultados.json";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const a = await sim("proof-a"), b = await sim("proof-b");
  const procs: Proc[] = [];
  const result: Record<string, unknown> = { geradoEm: new Date().toISOString(), ambiente: { node: process.version, cpus: os.cpus().length }, hipoteses: "Provedores simulados (planejar ~400 ms, sintetizar ~800 ms); 2 CPUs compartilhadas por 2 servidores, gerador e banco." };
  const cleanDb = async () => {
    await pool.query("DELETE FROM fmcc_ai_usage WHERE provider_id LIKE 'proof-%'");
    await pool.query("DELETE FROM fmcc_ai_route WHERE provider_id LIKE 'proof-%'");
    await pool.query("DELETE FROM fmcc_ai_provider WHERE id LIKE 'proof-%'");
  };
  try {
    await cleanDb();
    for (const [id, s] of [["proof-a", a], ["proof-b", b]] as const)
      await pool.query(`INSERT INTO fmcc_ai_provider(id,base_url,model,secret_ref,enabled,timeout_ms,currency,input_minor_per_million,output_minor_per_million) VALUES($1,$2,$3,'env://AI_KEY_PROOF',true,5000,'USD',300,1500)`, [id, s.url, `${id}-m`]);
    for (const t of ["analysis", "synthesis"]) {
      await pool.query(`INSERT INTO fmcc_ai_route(task_type,provider_id,role,weight,max_concurrent) VALUES($1,'proof-a','primary',1,8),($1,'proof-b','reserve',1,8)`, [t]);
    }
    let ai = start(PORT.ai, { FMCC_PROCESS_ROLE: "ai" });
    const op = start(PORT.op, { FMCC_PROCESS_ROLE: "operation" });
    procs.push(ai, op); await waitUp(ai); await waitUp(op);
    log("processos no ar");
    const cookie = await session("a"); const other = await session("b");

    log("P1 pergunta simples");
    const q1 = await ask(cookie);
    const w1 = q1.id ? await wait(cookie, q1.id) : null;
    const usage1 = await pool.query(`SELECT provider_id, count(*)::int n FROM fmcc_ai_usage u JOIN fmcc_work_item w ON w.id::text=u.task_id WHERE w.id=$1 GROUP BY 1`, [q1.id]);
    result.P1_perguntaSimples = { envio: { status: q1.status, ms: q1.ms }, andamento: w1, usoGravado: usage1.rows };

    log("P2 isolamento e limites");
    const q2 = await ask(cookie, "pergunta privada");
    const alheio = q2.id ? await api(other, `/api/core/query/${q2.id}`) : null;
    const semLogin = q2.id ? await fetch(`http://localhost:${PORT.op}/api/core/query/${q2.id}`) : null;
    const burst = []; for (let i = 0; i < 5; i++) burst.push((await ask(cookie, `rajada ${i}`)).status);
    result.P2_isolamentoELimites = { outraPessoaVe: alheio?.status, semLoginVe: semLogin?.status, rajadaDe5Status: burst };
    if (q2.id) await wait(cookie, q2.id); await sleep(3000);

    log("P3 provedor principal fora do ar");
    a.mode.fail = true;
    const q3 = await ask(cookie); const w3 = q3.id ? await wait(cookie, q3.id) : null;
    const usage3 = await pool.query(`SELECT provider_id FROM fmcc_ai_usage u WHERE u.task_id=$1`, [q3.id]);
    a.mode.fail = false;
    result.P3_principalForaDoAr = { andamento: w3, provedoresDeUso: usage3.rows.map((r) => r.provider_id) };

    log("P4 processo de IA derrubado com pergunta na fila");
    await stop(ai, "SIGKILL");
    const p4probe = probe(6000);
    const q4 = await ask(cookie);
    await sleep(1500);
    const mid = q4.id ? await (await api(cookie, `/api/core/query/${q4.id}`)).json() as { status?: string } : null;
    ai = start(PORT.ai, { FMCC_PROCESS_ROLE: "ai" }); procs.push(ai); await waitUp(ai);
    const w4 = q4.id ? await wait(cookie, q4.id, 60_000) : null;
    result.P4_iaDerrubada = { envioComIaMorta: { status: q4.status, ms: q4.ms }, estadoComIaMorta: mid?.status, sondaOperacaoDurante: await p4probe, depoisQueIaVolta: w4 };
  } finally {
    for (const p of procs.reverse()) await stop(p);
    a.server.closeAllConnections(); a.server.close(); b.server.closeAllConnections(); b.server.close();
    await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id IN (SELECT id FROM organization WHERE slug LIKE $1)", [`${T}-%`]).catch(() => undefined);
    await cleanDb().catch(() => undefined); await pool.end();
  }
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
