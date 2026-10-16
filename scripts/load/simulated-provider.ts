import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Provedor de IA simulado, compatível com /v1/chat/completions.
 * Serve para medir o nosso código sem chave real, sem custo e sem dado de cliente.
 * Os tempos e limites são hipóteses declaradas em cada cenário, não medidas de provedor real.
 */
export interface SimulatedProviderConfig {
  planMs: number;
  synthMs: number;
  jitterMs?: number;
  /** Acima desse número de chamadas simultâneas, responde 429 (cota). */
  maxConcurrent?: number;
  /** Fração de respostas 503 sorteadas (0 a 1). */
  errorRate?: number;
}

export interface SimulatedProvider {
  readonly baseUrl: string;
  readonly stats: { received: number; rejected429: number; failed503: number; peakInFlight: number };
  close(): Promise<void>;
}

export async function startSimulatedProvider(cfg: SimulatedProviderConfig): Promise<SimulatedProvider> {
  const stats = { received: 0, rejected429: 0, failed503: 0, peakInFlight: 0 };
  let inFlight = 0;
  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      stats.received += 1;
      if (cfg.maxConcurrent !== undefined && inFlight >= cfg.maxConcurrent) {
        stats.rejected429 += 1;
        res.writeHead(429, { "content-type": "application/json" }).end("{}");
        return;
      }
      if (cfg.errorRate && rand() < cfg.errorRate) {
        stats.failed503 += 1;
        res.writeHead(503, { "content-type": "application/json" }).end("{}");
        return;
      }
      inFlight += 1;
      stats.peakInFlight = Math.max(stats.peakInFlight, inFlight);
      let isPlan = true;
      let firstMetric = "metric";
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages: { role: string; content: string }[] };
        isPlan = body.messages[0].content.includes("planejador");
        if (isPlan) {
          const input = JSON.parse(body.messages[1].content) as { metricCatalog: { metricId: string }[] };
          firstMetric = input.metricCatalog[0]?.metricId ?? firstMetric;
        }
      } catch { /* corpo inesperado: responde como síntese */ }
      const delay = (isPlan ? cfg.planMs : cfg.synthMs) + rand() * (cfg.jitterMs ?? 0);
      setTimeout(() => {
        inFlight -= 1;
        const content = isPlan
          ? JSON.stringify({ metricIds: [firstMetric], capabilityIds: [], productSlugs: [] })
          : "Resposta simulada com base nos fatos recebidos.";
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content } }] }));
      }, delay);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stats,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
