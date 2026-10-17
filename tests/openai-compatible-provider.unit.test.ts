import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAiCompatibleProvider } from "@/infrastructure/core/openai-compatible-provider";
import { ProviderBadRequestError, ProviderRejectedError, ProviderTransientError, type ProviderConfig } from "@/domain/core/ai-provider";

let server: Server; let base = ""; let mode = "ok"; const seen: { auth?: string; body?: string }[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ auth: req.headers.authorization, body });
      if (mode === "redirect") return void res.writeHead(302, { location: "http://127.0.0.1:1/roubo" }).end();
      if (mode === "huge") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 9_000_000_000, completion_tokens: 1 } }));
      if (mode === "429") return void res.writeHead(429).end("limit");
      if (mode === "quota") return void res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: { type: "insufficient_quota", code: "credit_balance_exhausted", message: "sem credito" } }));
      if (mode === "500") return void res.writeHead(500).end("boom");
      if (mode === "401") return void res.writeHead(401).end("no");
      if (mode === "400") return void res.writeHead(400).end("bad");
      if (mode === "hang") return;
      if (mode === "html") return void res.writeHead(200).end("<html>");
      if (mode === "empty") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "  " } }] }));
      const usage = mode === "nousage" ? {} : { usage: { prompt_tokens: 11, completion_tokens: 7 } };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: "m-real", choices: [{ message: { content: "ola" } }], ...usage }));
    });
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.closeAllConnections(); server.close(); });

const cfg = (timeoutMs = 5000): ProviderConfig => ({ id: "p1", kind: "openai_compatible", baseUrl: base, model: "m", secretRef: "env://AI_KEY_TEST", timeoutMs, pricing: { currency: "USD", inputMinorPerMillion: 1, outputMinorPerMillion: 1 } });
const env = { AI_KEY_TEST: "segredo-de-teste-nao-vazar", FMCC_AI_ALLOW_LOCAL_PROVIDERS: "1" };
const req = { system: "sistema", user: "pergunta", maxTokens: 20 };
const call = (m: string, timeoutMs = 5000, e: Record<string, string | undefined> = env, signal = new AbortController().signal) => { mode = m; return new OpenAiCompatibleProvider(cfg(timeoutMs), e).invoke(req, signal); };

describe("adaptador compativel com OpenAI (contra servidor local)", () => {
  it("envia a chave so no cabecalho e le texto e uso reais", async () => {
    seen.length = 0;
    const r = await call("ok");
    expect(r).toEqual({ text: "ola", tokensIn: 11, tokensOut: 7, model: "m-real", estimated: false });
    expect(seen[0]!.auth).toBe("Bearer segredo-de-teste-nao-vazar");
    expect(seen[0]!.body).not.toContain("segredo");
    expect(JSON.parse(seen[0]!.body!)).toMatchObject({ model: "m", max_tokens: 20, stream: false });
  });
  it("sem informacao de uso, estima por caracteres e marca como estimado", async () => {
    const r = await call("nousage");
    expect(r.estimated).toBe(true);
    expect(r.tokensIn).toBe(Math.ceil(("sistema".length + "pergunta".length) / 4));
    expect(r.tokensOut).toBe(1);
  });
  it("classifica falhas: 429 e 5xx transitorias; 401 rejeitada; 400 pedido invalido", async () => {
    await expect(call("429")).rejects.toMatchObject({ name: "ProviderTransientError", code: "ai.provider_http_429" });
    await expect(call("500")).rejects.toBeInstanceOf(ProviderTransientError);
    await expect(call("401")).rejects.toMatchObject({ name: "ProviderRejectedError", code: "ai.provider_http_401" });
    await expect(call("400")).rejects.toBeInstanceOf(ProviderBadRequestError);
  });
  it("429 por credito esgotado e rejeicao do provedor (vai ao reserva), nao nova tentativa; 429 comum segue transitorio", async () => {
    await expect(call("quota")).rejects.toMatchObject({ name: "ProviderRejectedError", code: "ai.provider_quota_exhausted" });
    await expect(call("429")).rejects.toMatchObject({ name: "ProviderTransientError", code: "ai.provider_http_429" });
  });
  it("resposta fora do contrato e rejeitada, nao aceita como texto", async () => {
    await expect(call("html")).rejects.toBeInstanceOf(ProviderRejectedError);
    await expect(call("empty")).rejects.toMatchObject({ code: "ai.provider_response_empty" });
  });
  it("tempo esgotado e cancelamento do chamador sao falhas transitorias distintas", async () => {
    await expect(call("hang", 1000)).rejects.toMatchObject({ code: "ai.provider_timeout" });
    const ac = new AbortController(); setTimeout(() => ac.abort(), 50);
    await expect(call("hang", 5000, env, ac.signal)).rejects.toMatchObject({ code: "ai.provider_aborted" });
  }, 10_000);
  it("chave ausente nunca chama a rede e nunca expoe a referencia no erro de rede", async () => {
    seen.length = 0;
    await expect(call("ok", 5000, { FMCC_AI_ALLOW_LOCAL_PROVIDERS: "1" })).rejects.toMatchObject({ code: "ai.provider_secret_missing" });
    expect(seen).toHaveLength(0);
  });
  it("nao segue redirecionamento (a chave nao vai para outro endereco)", async () => {
    await expect(call("redirect")).rejects.toBeInstanceOf(ProviderTransientError);
  });
  it("uso absurdo informado pelo provedor e rejeitado antes de virar custo", async () => {
    await expect(call("huge")).rejects.toMatchObject({ code: "ai.provider_usage_out_of_range" });
  });
  it("base com caminho (ex.: .../openai/v1) e respeitada; raiz usa /v1/chat/completions", async () => {
    const paths: string[] = [];
    const f = (async (u: URL) => { paths.push(u.pathname); return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })); }) as unknown as typeof fetch;
    for (const baseUrl of ["https://api.exemplo.com", "https://api.exemplo.com/", "https://api.exemplo.com/openai/v1", "https://api.exemplo.com/openai/v1/"])
      await new OpenAiCompatibleProvider({ ...cfg(), baseUrl }, env, f).invoke(req, new AbortController().signal);
    expect(paths).toEqual(["/v1/chat/completions", "/v1/chat/completions", "/openai/v1/chat/completions", "/openai/v1/chat/completions"]);
  });
  it("recusa configuracao invalida na criacao", () => {
    expect(() => new OpenAiCompatibleProvider({ ...cfg(), secretRef: "sk-123" }, env)).toThrow("ai.provider_config_invalid");
  });
});
