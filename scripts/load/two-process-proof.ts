/**
 * Etapa 4: prova com processos Node reais (next start) e provedor de IA simulado.
 * Compara 1 processo que faz tudo com 2 processos (operação + IA) e provoca falhas.
 * Pré-requisito: `next build` feito e banco de teste migrado.
 * Uso: npx tsx scripts/load/two-process-proof.ts [saida.json]
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { startSimulatedProvider, type SimulatedProvider } from "./simulated-provider";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const pct = (s: number[], p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

const PORT = { all: 3200, op: 3201, ai: 3202 } as const;
// A prova da etapa 4 mede o caminho síncrono (a V2 passou a responder de forma assíncrona por padrão).
const baseEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", FMCC_CORE_QUERY_MODE: "sync" };

interface Proc { child: ChildProcess; port: number; }
function start(name: string, port: number, extra: Record<string, string>): Proc {
  const child: ChildProcess = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    env: { ...baseEnv, BETTER_AUTH_URL: `http://localhost:${port}`, ...extra }, stdio: "ignore",
  });
  child.on("error", () => {});
  void name;
  return { child, port };
}
async function waitUp(p: Proc, path = "/api/health") {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${p.port}${path}`); if (r.ok) return; } catch { /* ainda subindo */ } await sleep(500); }
  throw new Error(`processo na porta ${p.port} nao subiu`);
}
async function stop(p: Proc | undefined, signal: NodeJS.Signals = "SIGTERM") {
  if (!p || p.child.exitCode !== null) return;
  const done = new Promise((r) => p.child.once("exit", r));
  p.child.kill(signal);
  await Promise.race([done, sleep(8_000)]);
  if (p.child.exitCode === null) { p.child.kill("SIGKILL"); await Promise.race([done, sleep(3_000)]); }
}
const rss = (p: Proc) => { try { return Math.round(Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${p.child.pid}/status`, "utf8"))?.[1] ?? 0) / 1024); } catch { return 0; } };

function aiEnv(provider: SimulatedProvider): Record<string, string> {
  const url = new URL(provider.baseUrl);
  return {
    FMCC_PROCESS_ROLE: "ai", FMCC_COGNITIVE_MODEL_BASE_URL: `http://localhost:${url.port}`,
    FMCC_COGNITIVE_MODEL_API_KEY: "chave-simulada-de-teste", FMCC_COGNITIVE_MODEL_ID: "modelo-simulado",
  };
}

async function createSession(): Promise<string> {
  const origin = `http://localhost:${PORT.all}`;
  const h = { "content-type": "application/json", origin };
  const email = `prova-${Date.now()}@teste.local`;
  const up = await fetch(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: h, body: JSON.stringify({ name: "Prova Etapa 4", email, password: "senha-de-teste-123" }) });
  if (!up.ok) throw new Error("sign-up falhou");
  const jar = new Map<string, string>();
  for (const c of up.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const org = await fetch(`${origin}/api/auth/organization/create`, { method: "POST", headers: { ...h, cookie }, body: JSON.stringify({ name: "Empresa Prova", slug: `prova-${Date.now()}` }) });
  if (!org.ok) throw new Error("criar organizacao falhou");
  for (const c of org.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

interface Sample { t: number; ms: number; status: number }
function summarize(samples: Sample[]) {
  const by: Record<string, number> = {};
  for (const s of samples) by[s.status] = (by[s.status] ?? 0) + 1;
  const ok = samples.filter((s) => s.status === 200).map((s) => s.ms).sort((a, b) => a - b);
  const bad = samples.filter((s) => s.status !== 200).map((s) => s.ms).sort((a, b) => a - b);
  return {
    total: samples.length, porStatus: by,
    ok: { p50: r1(pct(ok, 50)), p95: r1(pct(ok, 95)), p99: r1(pct(ok, 99)) },
    naoOk: { p50: r1(pct(bad, 50)), p95: r1(pct(bad, 95)), max: r1(bad[bad.length - 1] ?? 0) },
  };
}

/** Carga de IA (workers em laço) + sonda de operação (/api/ready) durante `ms`. */
async function run(opts: { loadPort: number; probePort: number; cookie: string; workers: number; ms: number; during?: (elapsed: () => number) => Promise<void> }) {
  const load: Sample[] = []; const probe: Sample[] = [];
  const t0 = performance.now(); const elapsed = () => performance.now() - t0;
  let stopFlag = false;
  const worker = async () => {
    while (!stopFlag) {
      const s = performance.now();
      let status = 0;
      try {
        const r = await fetch(`http://localhost:${opts.loadPort}/api/core/query`, { method: "POST", headers: { "content-type": "application/json", cookie: opts.cookie }, body: JSON.stringify({ question: "como vai o faturamento?" }), signal: AbortSignal.timeout(40_000) });
        await r.text(); status = r.status;
      } catch { status = -1; }
      load.push({ t: s - t0, ms: performance.now() - s, status });
    }
  };
  const prober = async () => {
    while (!stopFlag) {
      const s = performance.now(); let status = 0;
      try { const r = await fetch(`http://localhost:${opts.probePort}/api/ready`, { signal: AbortSignal.timeout(10_000) }); await r.text(); status = r.status; } catch { status = -1; }
      probe.push({ t: s - t0, ms: performance.now() - s, status });
      await sleep(50);
    }
  };
  const tasks = [...Array.from({ length: opts.workers }, worker), prober(), opts.during ? opts.during(elapsed) : Promise.resolve()];
  await sleep(opts.ms); stopFlag = true; await Promise.all(tasks);
  return { load, probe };
}

async function main() {
  const out = process.argv[2] ?? "docs/medicoes/etapa-4-resultados.json";
  const result: Record<string, unknown> = {
    geradoEm: new Date().toISOString(),
    ambiente: { node: process.version, cpus: os.cpus().length, memMb: Math.round(os.totalmem() / 1048576) },
    hipoteses: "Provedor simulado (plano 800 ms, sintese 1500 ms). Tudo na mesma maquina de 2 CPUs: os processos e o gerador de carga disputam as mesmas CPUs.",
  };
  let provider = await startSimulatedProvider({ planMs: 800, synthMs: 1500, jitterMs: 200 });
  const procs: Proc[] = [];
  try {
    const all = start("all", PORT.all, { ...aiEnv(provider), FMCC_PROCESS_ROLE: "all" }); procs.push(all); await waitUp(all);
    log("processo unico no ar");
    const cookie = await createSession();
    log("sessao criada");
    const first = await fetch(`http://localhost:${PORT.all}/api/core/query`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ question: "como vai o faturamento?" }) });
    result.primeiraRespostaDoCore = { status: first.status, corpo: (await first.text()).slice(0, 200) };

    log("S1 inicio");
    // S1: um processo faz tudo
    const s1 = await run({ loadPort: PORT.all, probePort: PORT.all, cookie, workers: 100, ms: 15_000 });
    result.S1_umProcessoFazTudo = { rssMbDepois: rss(all), carga: summarize(s1.load), sondaOperacao: summarize(s1.probe) };
    await stop(all);

    log("S2 inicio");
    // S2: dois processos
    let ai = start("ai", PORT.ai, aiEnv(provider)); procs.push(ai);
    const op = start("op", PORT.op, { FMCC_PROCESS_ROLE: "operation", FMCC_AI_SERVICE_URL: `http://localhost:${PORT.ai}`, FMCC_AI_PROXY_TIMEOUT_MS: "5000", FMCC_AI_PROXY_MAX_CONCURRENT: "64", FMCC_AI_PROXY_FAILURE_THRESHOLD: "5", FMCC_AI_PROXY_OPEN_MS: "5000" }); procs.push(op);
    await waitUp(ai); await waitUp(op);
    const s2 = await run({ loadPort: PORT.op, probePort: PORT.op, cookie, workers: 100, ms: 15_000 });
    result.S2_doisProcessos = { rssMbOperacao: rss(op), rssMbIA: rss(ai), carga: summarize(s2.load), sondaOperacao: summarize(s2.probe) };
    const notServed = await fetch(`http://localhost:${PORT.ai}/dashboard`, { redirect: "manual" });
    result.S2_processoDeIaNaoServeOperacao = { status: notServed.status };

    log("S3 inicio");
    // S3: o processo de IA cai no meio da carga e volta depois
    const events: Record<string, number> = {};
    const s3 = await run({ loadPort: PORT.op, probePort: PORT.op, cookie, workers: 100, ms: 30_000, during: async (el) => {
      while (el() < 8_000) await sleep(50);
      events.matouIAEmMs = r1(el()); await stop(ai, "SIGKILL");
      while (el() < 20_000) await sleep(50);
      events.religouIAEmMs = r1(el()); ai = start("ai", PORT.ai, aiEnv(provider)); procs.push(ai); await waitUp(ai);
      events.iaRespondendoEmMs = r1(el());
    } });
    const after = s3.load.filter((s) => s.t > (events.matouIAEmMs ?? 0));
    const firstFail = after.find((s) => s.status !== 200 && s.status !== 0);
    const lastOkBeforeBack = s3.load.filter((s) => s.status === 200 && s.t > (events.iaRespondendoEmMs ?? 1e9)).sort((a, b) => a.t - b.t)[0];
    result.S3_iaCaiEVolta = {
      eventos: events, carga: summarize(s3.load), sondaOperacao: summarize(s3.probe),
      primeiroErroDepoisDeMatarEmMs: firstFail ? r1(firstFail.t - (events.matouIAEmMs ?? 0)) : null,
      primeiroSucessoDepoisDeReligarEmMs: lastOkBeforeBack ? r1(lastOkBeforeBack.t - (events.religouIAEmMs ?? 0)) : null,
      errosInstantaneosDepoisDeCair: after.filter((s) => s.status === 503 && s.ms < 200).length,
    };

    log("S4 inicio");
    // S4: o provedor trava (nunca responde)
    await stop(ai); await provider.close();
    provider = await startSimulatedProvider({ planMs: 3_600_000, synthMs: 3_600_000 });
    ai = start("ai", PORT.ai, aiEnv(provider)); procs.push(ai); await waitUp(ai);
    // abre de novo o disjuntor da operação (estado limpo): reinicia a operação
    await stop(op);
    const op2 = start("op", PORT.op, { FMCC_PROCESS_ROLE: "operation", FMCC_AI_SERVICE_URL: `http://localhost:${PORT.ai}`, FMCC_AI_PROXY_TIMEOUT_MS: "3000", FMCC_AI_PROXY_MAX_CONCURRENT: "64", FMCC_AI_PROXY_FAILURE_THRESHOLD: "5", FMCC_AI_PROXY_OPEN_MS: "5000" }); procs.push(op2); await waitUp(op2);
    const s4 = await run({ loadPort: PORT.op, probePort: PORT.op, cookie, workers: 100, ms: 20_000 });
    result.S4_provedorTravado = { rssMbOperacao: rss(op2), rssMbIA: rss(ai), carga: summarize(s4.load), sondaOperacao: summarize(s4.probe) };
  } finally {
    for (const p of procs) await stop(p, "SIGKILL").catch(() => {});
    await provider.close();
  }
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}
void main();
