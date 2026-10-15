import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { Bulkhead, CircuitBreaker } from "@/domain/core/resilience";
import { aiServiceConfig, processRole, type AiServiceConfig } from "@/config/process-role";
import { createAiBridge } from "@/infrastructure/core/ai-service-client";
import { proxy } from "@/proxy";

describe("divisoria (limite de simultaneas)", () => {
  it("recusa acima do limite e libera a vaga uma unica vez", () => {
    const b = new Bulkhead(2);
    const r1 = b.tryAcquire(); const r2 = b.tryAcquire();
    expect(r1 && r2).toBeTruthy();
    expect(b.tryAcquire()).toBeNull();
    r1?.(); r1?.(); // liberar duas vezes nao abre duas vagas
    expect(b.current).toBe(1);
    expect(b.tryAcquire()).not.toBeNull();
    expect(b.tryAcquire()).toBeNull();
  });
  it("recusa limite invalido", () => { expect(() => new Bulkhead(0)).toThrow(); });
});

describe("disjuntor", () => {
  it("abre apos falhas seguidas, recusa, testa uma vez e fecha com sucesso", () => {
    let t = 0;
    const c = new CircuitBreaker({ failureThreshold: 3, openMs: 1000 }, () => t);
    expect(c.allow()).toBe(true);
    c.recordFailure(); c.recordFailure();
    expect(c.state).toBe("closed");
    c.recordFailure();
    expect(c.state).toBe("open");
    expect(c.allow()).toBe(false);
    t = 999; expect(c.allow()).toBe(false);
    t = 1000; expect(c.state).toBe("half-open");
    expect(c.allow()).toBe(true);   // a chamada de teste
    expect(c.allow()).toBe(false);  // as outras esperam o resultado
    c.recordSuccess();
    expect(c.state).toBe("closed");
    expect(c.allow()).toBe(true);
  });
  it("falha no teste reabre por mais um periodo inteiro", () => {
    let t = 0;
    const c = new CircuitBreaker({ failureThreshold: 1, openMs: 1000 }, () => t);
    c.recordFailure(); t = 1000;
    expect(c.allow()).toBe(true);
    c.recordFailure();
    expect(c.state).toBe("open");
    t = 1999; expect(c.state).toBe("open");
    t = 2000; expect(c.state).toBe("half-open");
  });
  it("sucesso zera a contagem de falhas seguidas", () => {
    const c = new CircuitBreaker({ failureThreshold: 2, openMs: 1000 });
    c.recordFailure(); c.recordSuccess(); c.recordFailure();
    expect(c.state).toBe("closed");
  });
});

describe("papel do processo e configuracao da ponte", () => {
  it("padrao e all (V1), valores validos passam e invalido falha rapido", () => {
    expect(processRole({})).toBe("all");
    expect(processRole({ FMCC_PROCESS_ROLE: " AI " })).toBe("ai");
    expect(processRole({ FMCC_PROCESS_ROLE: "operation" })).toBe("operation");
    expect(() => processRole({ FMCC_PROCESS_ROLE: "tudo" })).toThrow("config.FMCC_PROCESS_ROLE_invalid");
  });
  it("ponte: sem endereco nao ha config; endereco e limites validados", () => {
    expect(aiServiceConfig({})).toBeNull();
    const c = aiServiceConfig({ FMCC_AI_SERVICE_URL: "http://ai.internal:3000/qualquer/caminho", FMCC_AI_PROXY_MAX_CONCURRENT: "8" });
    expect(c).toMatchObject({ baseUrl: "http://ai.internal:3000", maxConcurrent: 8, timeoutMs: 35000, failureThreshold: 5, openMs: 15000 });
    expect(() => aiServiceConfig({ FMCC_AI_SERVICE_URL: "ftp://x" })).toThrow();
    expect(() => aiServiceConfig({ FMCC_AI_SERVICE_URL: "nao-e-url" })).toThrow();
    expect(() => aiServiceConfig({ FMCC_AI_SERVICE_URL: "http://x", FMCC_AI_PROXY_TIMEOUT_MS: "0" })).toThrow();
  });
});

describe("guarda do processo de IA", () => {
  const req = (path: string) => new NextRequest(`http://localhost${path}`);
  const withRole = async (role: string | undefined, fn: () => void) => {
    const before = process.env.FMCC_PROCESS_ROLE;
    if (role === undefined) delete process.env.FMCC_PROCESS_ROLE; else process.env.FMCC_PROCESS_ROLE = role;
    try { fn(); } finally { if (before === undefined) delete process.env.FMCC_PROCESS_ROLE; else process.env.FMCC_PROCESS_ROLE = before; }
  };
  it("no papel ai, so as rotas de IA e de saude existem", async () => {
    await withRole("ai", () => {
      expect(proxy(req("/api/core/query")).status).toBe(200);
      expect(proxy(req("/api/health")).status).toBe(200);
      expect(proxy(req("/api/ready")).status).toBe(200);
      expect(proxy(req("/dashboard")).status).toBe(404);
      expect(proxy(req("/api/metrics/overview")).status).toBe(404);
      expect(proxy(req("/api/billing/anything")).status).toBe(404);
      expect(proxy(req("/api/corex")).status).toBe(404);
    });
  });
  it("nos outros papeis nada muda", async () => {
    for (const role of [undefined, "all", "operation"]) {
      await withRole(role, () => { expect(proxy(req("/dashboard")).status).toBe(200); expect(proxy(req("/api/metrics/overview")).status).toBe(200); });
    }
  });
});

describe("ponte do processo de operacao para o de IA", () => {
  let server: Server | undefined;
  afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((r) => server!.close(() => r())); server = undefined; } });

  async function upstream(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void) {
    server = createServer(handler);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const cfg = (baseUrl: string, over: Partial<AiServiceConfig> = {}): AiServiceConfig =>
    ({ baseUrl, timeoutMs: 500, maxConcurrent: 2, failureThreshold: 2, openMs: 1000, ...over });
  const post = (body = '{"question":"oi"}', headers: Record<string, string> = {}) =>
    new Request("http://op/api/core/query", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

  it("repassa corpo, sessao e idioma, mas nao repassa outros cabecalhos", async () => {
    let seen: Record<string, string | string[] | undefined> = {}; let seenBody = "";
    const url = await upstream((req, res) => {
      seen = req.headers; let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { seenBody = b; res.writeHead(200, { "content-type": "application/json" }).end('{"answer":"ok"}'); });
    });
    const r = await createAiBridge(cfg(url)).forward(post('{"question":"vendas?"}', { cookie: "s=1", "accept-language": "en-US", authorization: "Bearer segredo", "x-forwarded-for": "9.9.9.9" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ answer: "ok" });
    expect(seenBody).toBe('{"question":"vendas?"}');
    expect(seen.cookie).toBe("s=1");
    expect(seen["accept-language"]).toBe("en-US");
    expect(seen.authorization).toBeUndefined();
    expect(seen["x-forwarded-for"]).toBeUndefined();
  });

  it("erro do usuario (4xx) passa direto e nao abre o disjuntor", async () => {
    let hits = 0;
    const url = await upstream((_q, res) => { hits += 1; res.writeHead(400, { "content-type": "application/json" }).end('{"error":"core.invalid_argument"}'); });
    const bridge = createAiBridge(cfg(url, { failureThreshold: 1 }));
    for (let i = 0; i < 4; i++) expect((await bridge.forward(post())).status).toBe(400);
    expect(hits).toBe(4);
  });

  it("falhas 5xx abrem o disjuntor e as chamadas seguintes nem chegam ao processo de IA", async () => {
    let hits = 0;
    const url = await upstream((_q, res) => { hits += 1; res.writeHead(503).end('{"error":"core.cognitive_model_unavailable"}'); });
    const bridge = createAiBridge(cfg(url));
    expect((await bridge.forward(post())).status).toBe(503);
    expect((await bridge.forward(post())).status).toBe(503);
    expect(hits).toBe(2);
    const started = Date.now();
    const blocked = await bridge.forward(post());
    expect(blocked.status).toBe(503);
    expect((await blocked.json()).error).toBe("core.ai_service_unavailable");
    expect(blocked.headers.get("retry-after")).toBe("1");
    expect(Date.now() - started).toBeLessThan(100);
    expect(hits).toBe(2); // nao chamou
  });

  it("processo de IA fora do ar: erro rapido, depois o disjuntor poupa as conexoes; recupera sozinho", async () => {
    let t = 0;
    let alive = false; let hits = 0;
    const url = await upstream((_q, res) => { hits += 1; if (alive) res.writeHead(200).end('{"answer":"voltou"}'); else res.destroy(); });
    const bridge = createAiBridge(cfg(url), { now: () => t });
    expect((await bridge.forward(post())).status).toBe(503);
    expect((await bridge.forward(post())).status).toBe(503);
    expect((await bridge.forward(post())).status).toBe(503); // aberto
    expect(hits).toBe(2);
    alive = true; t = 1000;
    const recovered = await bridge.forward(post());
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ answer: "voltou" });
    expect((await bridge.forward(post())).status).toBe(200);
  });

  it("processo de IA travado: a ponte desiste no tempo limite e libera a vaga", async () => {
    const url = await upstream(() => { /* nunca responde */ });
    const bridge = createAiBridge(cfg(url, { timeoutMs: 150, failureThreshold: 10 }));
    const started = Date.now();
    const r = await bridge.forward(post());
    expect(r.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("limite de simultaneas: o excedente e recusado na hora, sem esperar o processo de IA", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    let hits = 0;
    const url = await upstream((_q, res) => { hits += 1; gate.then(() => res.writeHead(200).end('{"answer":"ok"}')); });
    const bridge = createAiBridge(cfg(url, { maxConcurrent: 2, timeoutMs: 5000 }));
    const a = bridge.forward(post()); const b = bridge.forward(post());
    await new Promise((r) => setTimeout(r, 50));
    const started = Date.now();
    const c = await bridge.forward(post());
    expect(c.status).toBe(503);
    expect((await c.json()).error).toBe("core.ai_capacity_exceeded");
    expect(Date.now() - started).toBeLessThan(100);
    release();
    expect((await a).status).toBe(200); expect((await b).status).toBe(200);
    expect(hits).toBe(2);
    expect((await bridge.forward(post())).status).toBe(200); // a vaga voltou
  });
});
