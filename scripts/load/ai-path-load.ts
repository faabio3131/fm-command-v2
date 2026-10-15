/**
 * Etapa 1 (Medir): carga no caminho da IA do Command, com provedor simulado.
 * Mede o NOSSO código (adaptador real + núcleo FMCC) em um único processo Node.
 * Não mede: provedor real, rede, banco, autenticação, rota HTTP do Next.
 * Uso: npx tsx scripts/load/ai-path-load.ts [saida.json]
 */
import { createServer } from "node:http";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { FmccVerticalCognitiveCore } from "@/application/core/fmcc-vertical-cognitive-core";
import { OpenAiCompatibleCognitiveModel } from "@/infrastructure/core/openai-compatible-cognitive-model";
import { FINANCIAL_DERIVED_METRICS } from "@/domain/finance/intelligence";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { startSimulatedProvider, type SimulatedProviderConfig } from "./simulated-provider";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const round = (n: number) => Math.round(n * 10) / 10;

// Os avisos do adaptador (429/503) são contados, não impressos.
let warnCount = 0;
const realWarn = console.warn;
console.warn = () => { warnCount += 1; };
console.info = () => {};

interface LevelResult {
  concurrency: number; requests: number; ok: number; failed: number; failedPct: number;
  p50: number; p95: number; p99: number; max: number; throughputPerSec: number;
  providerPeakInFlight: number; provider429: number; provider503: number; rssMb: number;
}

async function runLevel(cfg: SimulatedProviderConfig, concurrency: number, wavesPerWorker: number, timeoutMs = 30_000): Promise<LevelResult> {
  const provider = await startSimulatedProvider(cfg);
  const core = new FmccVerticalCognitiveCore(new OpenAiCompatibleCognitiveModel(provider.baseUrl, "chave-de-teste", "modelo-simulado", timeoutMs));
  const lat: number[] = [];
  let failed = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let w = 0; w < wavesPerWorker; w++) {
      const s = performance.now();
      try {
        await core.plan({ question: "como vai o faturamento?", operationalContext: [] });
        await sleep(5); // leitura determinística simulada (o banco não é medido aqui)
        await core.synthesize({ question: "q", facts: [], evidence: [], operationalContext: [] });
        lat.push(performance.now() - s);
      } catch { failed += 1; }
    }
  }));
  const elapsed = (performance.now() - t0) / 1000;
  const sorted = [...lat].sort((a, b) => a - b);
  const total = concurrency * wavesPerWorker;
  const res: LevelResult = {
    concurrency, requests: total, ok: lat.length, failed, failedPct: round((failed / total) * 100),
    p50: round(pct(sorted, 50)), p95: round(pct(sorted, 95)), p99: round(pct(sorted, 99)), max: round(sorted[sorted.length - 1] ?? 0),
    throughputPerSec: round(lat.length / elapsed), providerPeakInFlight: provider.stats.peakInFlight,
    provider429: provider.stats.rejected429, provider503: provider.stats.failed503,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  };
  await provider.close();
  return res;
}

async function healthProbe(withLoad: boolean) {
  const health = createServer((_q, r) => r.writeHead(200).end("ok"));
  await new Promise<void>((resolve) => health.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(health.address() as AddressInfo).port}/`;
  const hist = monitorEventLoopDelay({ resolution: 10 }); hist.enable();
  const probes: number[] = [];
  let stop = false;
  const prober = (async () => {
    while (!stop) { const s = performance.now(); await (await fetch(url)).text(); probes.push(performance.now() - s); await sleep(50); }
  })();
  if (withLoad) await runLevel({ planMs: 800, synthMs: 1500, jitterMs: 200 }, 200, 2);
  else await sleep(6000);
  stop = true; await prober; hist.disable(); health.closeAllConnections(); health.close();
  const sorted = probes.sort((a, b) => a - b);
  return { withAiLoad: withLoad, probes: probes.length, p50: round(pct(sorted, 50)), p95: round(pct(sorted, 95)), p99: round(pct(sorted, 99)), max: round(sorted[sorted.length - 1] ?? 0), eventLoopDelayP99Ms: round(hist.percentile(99) / 1e6) };
}

async function main() {
  const out = process.argv[2] ?? "docs/medicoes/etapa-1-resultados.json";
  const catalog = JSON.stringify([...METRIC_REGISTRY.map(({ metricId, displayName, description }) => ({ metricId, displayName, description })), ...FINANCIAL_DERIVED_METRICS]);
  const env = { node: process.version, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemMb: Math.round(os.totalmem() / 1048576) };

  const A: LevelResult[] = [];
  for (const c of [1, 10, 50, 100, 200, 400]) A.push(await runLevel({ planMs: 800, synthMs: 1500, jitterMs: 200 }, c, c <= 10 ? 5 : 3));
  const B: LevelResult[] = [];
  for (const c of [10, 20, 50, 100]) B.push(await runLevel({ planMs: 800, synthMs: 1500, jitterMs: 200, maxConcurrent: 20 }, c, 3));
  const C = await runLevel({ planMs: 800, synthMs: 1500, jitterMs: 200, errorRate: 0.05 }, 50, 4);
  const D = await runLevel({ planMs: 800, synthMs: 1500, jitterMs: 100 }, 20, 2, 1000);
  const E = [await healthProbe(false), await healthProbe(true)];

  const result = {
    geradoEm: new Date().toISOString(), ambiente: env,
    hipoteses: "Provedor simulado local: plano 800 ms, sintese 1500 ms, jitter 200 ms. Latencia e cota de provedor real NAO foram medidas.",
    tamanhoDoCatalogoNoPlanejamento: { bytes: catalog.length, tokensEstimados: Math.round(catalog.length / 4), metricas: METRIC_REGISTRY.length + FINANCIAL_DERIVED_METRICS.length },
    A_semLimiteNoProvedor: A, B_provedorLimitadoA20Simultaneas: B, C_5porCentoDe503: C, D_timeoutDe1sComSintese1_5s: D, E_painelNoMesmoProcesso: E,
    avisosDoAdaptador: warnCount,
  };
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  console.warn = realWarn;
  console.log(JSON.stringify(result, null, 2));
}
void main();
