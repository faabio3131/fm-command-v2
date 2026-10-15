import { describe, expect, it } from "vitest";
import { ProviderRouter, type AiConfigSnapshot, type AiConfigSource, type UsageRecord } from "@/application/core/provider-router";
import {
  costMicroMinor, microToMoney, NoProviderAvailableError, ProviderBadRequestError, ProviderRejectedError, ProviderTransientError,
  validateProviderConfig, type AiProvider, type ProviderConfig,
} from "@/domain/core/ai-provider";
import type { RoutingRow } from "@/domain/core/routing-policy";

const cfg = (id: string, extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id, kind: "openai_compatible", baseUrl: "https://api.example.com", model: `${id}-model`, secretRef: "env://AI_KEY_" + id.toUpperCase().replace(/[^A-Z0-9]/g, "_"),
  timeoutMs: 5000, pricing: { currency: "USD", inputMinorPerMillion: 300, outputMinorPerMillion: 1500 }, ...extra,
});
const row = (providerId: string, role: "primary" | "reserve", extra: Partial<RoutingRow> = {}): RoutingRow =>
  ({ taskType: "analysis", tenantId: null, providerId, role, weight: 1, maxConcurrent: 4, ...extra });

class Source implements AiConfigSource {
  usage: UsageRecord[] = [];
  loads = 0;
  constructor(public snap: AiConfigSnapshot) {}
  async load() { this.loads++; return this.snap; }
  async recordUsage(u: UsageRecord) { this.usage.push(u); }
}
type Behavior = (call: number) => Promise<{ text: string; tokensIn?: number; tokensOut?: number }> | { text: string; tokensIn?: number; tokensOut?: number };
function fake(id: string, behavior: Behavior): AiProvider & { calls: number } {
  const p = {
    id, calls: 0,
    async invoke() {
      p.calls++;
      const r = await behavior(p.calls);
      return { text: r.text, tokensIn: r.tokensIn ?? 100, tokensOut: r.tokensOut ?? 50, model: `${id}-model`, estimated: false };
    },
  };
  return p;
}
const ok = (t = "ok") => () => ({ text: t });
const transient = () => { throw new ProviderTransientError("ai.provider_http_503"); };
const input = { tenantId: "t1", taskId: "task-1", taskType: "analysis" as const, request: { system: "s", user: "u", maxTokens: 10 } };

function make(providers: Record<string, AiProvider>, snap: Partial<AiConfigSnapshot> & { rows: RoutingRow[] }, extra: { random?: () => number; failureThreshold?: number } = {}) {
  const source = new Source({ providers: Object.keys(providers).map((id) => cfg(id)), allowedByTenant: {}, ...snap });
  const router = new ProviderRouter({ config: source, makeProvider: (c) => providers[c.id]!, random: extra.random ?? (() => 0), failureThreshold: extra.failureThreshold, openMs: 60_000 });
  return { source, router };
}

describe("custo e configuracao de provedores (ADR-017)", () => {
  it("custo exato em milionesimos: nao arredonda cada chamada para 1 centavo", () => {
    const pricing = { currency: "USD", inputMinorPerMillion: 15, outputMinorPerMillion: 60 }; // 0,15 e 0,60 USD por milhao
    const micro = costMicroMinor(1000, 500, pricing);
    expect(micro).toBe(1000 * 15 + 500 * 60);
    expect(micro / 1_000_000).toBeLessThan(0.1); // bem menos de 1 centavo
    const m = microToMoney(micro * 100_000, "USD"); // 100 mil chamadas iguais
    expect(m.ok && m.value).toEqual({ amountMinor: 4500, currency: "USD" });
  });
  it("recusa apontar o segredo para variavel que nao e de IA (DATABASE_URL etc.)", () => {
    for (const ref of ["env://DATABASE_URL", "env://BETTER_AUTH_SECRET", "env://AI_KEY_", "env://ai_key_x"])
      expect(validateProviderConfig(cfg("prov-a", { secretRef: ref }))).toContain("provider.secret_ref_must_be_env_reference");
    expect(validateProviderConfig(cfg("prov-a", { secretRef: "env://AI_KEY_OPENAI" }))).toEqual([]);
  });
  it("recusa enderecos internos (SSRF): metadados de nuvem, rede privada, loopback, IPv6 local", () => {
    for (const h of ["169.254.169.254", "10.0.0.5", "172.16.3.1", "192.168.1.9", "127.0.0.1", "localhost", "metadata.google.internal", "[::1]", "[fd00::1]", "100.64.0.1"])
      expect(validateProviderConfig(cfg("prov-a", { baseUrl: `https://${h}` })), h).toContain("provider.base_url_private_address_not_allowed");
    expect(validateProviderConfig(cfg("prov-a", { baseUrl: "https://api.openai.com" }))).toEqual([]);
    expect(validateProviderConfig(cfg("prov-a", { baseUrl: "https://8.8.8.8" }))).toEqual([]);
  });
  it("limita preco para o custo nunca estourar", () => {
    expect(validateProviderConfig(cfg("prov-a", { pricing: { currency: "USD", inputMinorPerMillion: 100_000_001, outputMinorPerMillion: 0 } }))).toContain("provider.inputMinorPerMillion_invalid");
  });
  it("recusa chave dentro do banco, endereco sem https e credencial na URL", () => {
    expect(validateProviderConfig(cfg("prov-a"))).toEqual([]);
    expect(validateProviderConfig(cfg("prov-a", { secretRef: "sk-abc123" }))).toContain("provider.secret_ref_must_be_env_reference");
    expect(validateProviderConfig(cfg("prov-a", { baseUrl: "http://api.example.com" }))).toContain("provider.base_url_must_be_https");
    expect(validateProviderConfig(cfg("prov-a", { baseUrl: "http://127.0.0.1:9000" }))).toContain("provider.base_url_must_be_https");
    expect(validateProviderConfig(cfg("prov-a", { baseUrl: "http://127.0.0.1:9000" }), { allowLocal: true })).toEqual([]);
    expect(validateProviderConfig(cfg("prov-a", { baseUrl: "https://u:p@api.example.com" }))).toContain("provider.base_url_must_not_embed_credentials");
    expect(validateProviderConfig(cfg("prov-a", { pricing: { currency: "usd", inputMinorPerMillion: -1, outputMinorPerMillion: 0 } }))).toEqual(
      expect.arrayContaining(["provider.currency_must_be_iso_4217", "provider.inputMinorPerMillion_invalid"]));
  });
});

describe("roteador de provedores (ADR-017)", () => {
  it("usa o principal e registra uso e custo exatos", async () => {
    const a = fake("a", ok("resposta"));
    const { router, source } = make({ a }, { rows: [row("a", "primary")] });
    const r = await router.execute(input);
    expect(r).toMatchObject({ text: "resposta", providerId: "a", role: "primary", attempted: ["a"], costMicroMinor: 100 * 300 + 50 * 1500, currency: "USD" });
    expect(source.usage).toHaveLength(1);
    expect(source.usage[0]).toMatchObject({ tenantId: "t1", taskId: "task-1", providerId: "a", tokensIn: 100, tokensOut: 50, costMicroMinor: 105000 });
  });

  it("falha transitoria do principal passa ao reserva e a tarefa nao falha", async () => {
    const a = fake("a", transient); const b = fake("b", ok("do reserva"));
    const { router } = make({ a, b }, { rows: [row("a", "primary"), row("b", "reserve")] });
    const r = await router.execute(input);
    expect(r).toMatchObject({ providerId: "b", role: "reserve", attempted: ["a", "b"], text: "do reserva" });
  });

  it("chave recusada (provedor rejeitou) tambem passa ao reserva", async () => {
    const a = fake("a", () => { throw new ProviderRejectedError("ai.provider_http_401"); }); const b = fake("b", ok());
    const { router } = make({ a, b }, { rows: [row("a", "primary"), row("b", "reserve")] });
    expect((await router.execute(input)).providerId).toBe("b");
  });

  it("pedido invalido nao troca de provedor e nao abre o disjuntor", async () => {
    const a = fake("a", () => { throw new ProviderBadRequestError("ai.provider_http_400"); }); const b = fake("b", ok());
    const { router } = make({ a, b }, { rows: [row("a", "primary"), row("b", "reserve")] }, { failureThreshold: 1 });
    await expect(router.execute(input)).rejects.toBeInstanceOf(ProviderBadRequestError);
    expect(b.calls).toBe(0);
    await expect(router.execute(input)).rejects.toBeInstanceOf(ProviderBadRequestError); // disjuntor continua fechado
    expect(a.calls).toBe(2);
  });

  it("todos falham: erro claro com a lista de tentados", async () => {
    const a = fake("a", transient); const b = fake("b", transient);
    const { router } = make({ a, b }, { rows: [row("a", "primary"), row("b", "reserve")] });
    const e = await router.execute(input).catch((x) => x);
    expect(e).toBeInstanceOf(NoProviderAvailableError);
    expect(e.attempted).toEqual(["a", "b"]);
  });

  it("disjuntor abre depois de falhas seguidas e deixa de chamar o provedor ruim", async () => {
    const a = fake("a", transient); const b = fake("b", ok());
    const { router } = make({ a, b }, { rows: [row("a", "primary"), row("b", "reserve")] }, { failureThreshold: 2 });
    for (let i = 0; i < 2; i++) await router.execute(input);
    expect(a.calls).toBe(2);
    for (let i = 0; i < 5; i++) await router.execute(input);
    expect(a.calls).toBe(2); // aberto: nao chama mais
    expect(b.calls).toBe(7);
  });

  it("linha do cliente substitui a padrao; so os provedores dele valem", async () => {
    const a = fake("a", ok("padrao")); const d = fake("d", ok("dedicado"));
    const { router } = make({ a, d }, { rows: [row("a", "primary"), row("d", "primary", { tenantId: "t1" })] });
    expect((await router.execute(input)).providerId).toBe("d");
    expect((await router.execute({ ...input, tenantId: "t2" })).providerId).toBe("a");
  });

  it("provedores permitidos do cliente: fora da lista nunca e chamado, mesmo sendo o unico", async () => {
    const a = fake("a", ok()); const b = fake("b", ok());
    const { router } = make({ a, b }, { rows: [row("a", "primary"), row("b", "reserve")], allowedByTenant: { t1: ["b"] } });
    expect((await router.execute(input)).providerId).toBe("b");
    const { router: r2 } = make({ a, b }, { rows: [row("a", "primary")], allowedByTenant: { t1: ["b"] } });
    await expect(r2.execute(input)).rejects.toBeInstanceOf(NoProviderAvailableError);
    expect(a.calls).toBe(0);
  });

  it("divide a carga por peso entre provedores do mesmo nivel", async () => {
    const a = fake("a", ok()); const b = fake("b", ok());
    let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const { router } = make({ a, b }, { rows: [row("a", "primary", { weight: 3 }), row("b", "primary", { weight: 1 })] }, { random: rnd });
    for (let i = 0; i < 400; i++) await router.execute(input);
    expect(a.calls + b.calls).toBe(400);
    expect(a.calls / 400).toBeGreaterThan(0.68);
    expect(a.calls / 400).toBeLessThan(0.82);
  });

  it("respeita o limite de simultaneas do provedor e usa o reserva no excesso", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const a = fake("a", async () => { await gate; return { text: "a" }; }); const b = fake("b", ok("b"));
    const { router } = make({ a, b }, { rows: [row("a", "primary", { maxConcurrent: 2 }), row("b", "reserve")] });
    const first = [router.execute(input), router.execute(input)];
    await new Promise((r) => setTimeout(r, 10));
    const third = await router.execute(input); // a esta cheio
    expect(third.providerId).toBe("b");
    release();
    expect((await Promise.all(first)).map((x) => x.providerId)).toEqual(["a", "a"]);
  });

  it("falha ao gravar o uso nao joga fora a resposta", async () => {
    const a = fake("a", ok("paga"));
    const { router, source } = make({ a }, { rows: [row("a", "primary")] });
    source.recordUsage = async () => { throw new Error("banco fora"); };
    expect((await router.execute(input)).text).toBe("paga");
  });

  it("sem nenhuma linha para a tarefa: erro, sem chamar ninguem", async () => {
    const a = fake("a", ok());
    const { router } = make({ a }, { rows: [row("a", "primary", { taskType: "decision" })] });
    await expect(router.execute(input)).rejects.toBeInstanceOf(NoProviderAvailableError);
    expect(a.calls).toBe(0);
  });

  it("le a configuracao de novo depois do prazo, sem reiniciar", async () => {
    const a = fake("a", ok("a")); const b = fake("b", ok("b"));
    let t = 0;
    const source = new Source({ providers: [cfg("a"), cfg("b")], rows: [row("a", "primary")], allowedByTenant: {} });
    const router = new ProviderRouter({ config: source, makeProvider: (c) => (c.id === "a" ? a : b), random: () => 0, configTtlMs: 1000, now: () => t });
    expect((await router.execute(input)).providerId).toBe("a");
    source.snap = { ...source.snap, rows: [row("b", "primary")] };
    expect((await router.execute(input)).providerId).toBe("a"); // ainda em cache
    t = 2000;
    expect((await router.execute(input)).providerId).toBe("b");
    expect(source.loads).toBe(2);
  });

  it("cancelamento da chamada de teste do disjuntor nao deixa o provedor preso para sempre", async () => {
    let t = 0;
    let mode: "fail" | "slow" | "ok" = "fail";
    const ac = new AbortController();
    const a = fake("a", async () => {
      if (mode === "fail") throw new ProviderTransientError("ai.provider_http_503");
      if (mode === "slow") { ac.abort(); throw new ProviderTransientError("ai.provider_aborted"); }
      return { text: "voltou" };
    });
    const source = new Source({ providers: [cfg("a")], rows: [row("a", "primary")], allowedByTenant: {} });
    const router = new ProviderRouter({ config: source, makeProvider: () => a, random: () => 0, failureThreshold: 1, openMs: 1000, now: () => t });
    await expect(router.execute(input)).rejects.toBeInstanceOf(NoProviderAvailableError); // abre
    t = 2000; mode = "slow";
    await expect(router.execute({ ...input, signal: ac.signal })).rejects.toBeInstanceOf(ProviderTransientError); // teste cancelado
    mode = "ok";
    expect((await router.execute(input)).text).toBe("voltou"); // novo teste e permitido
  });

  it("recusa por conteudo (403) falha so aquele pedido e nao abre o disjuntor de todos", async () => {
    const a = fake("a", () => { throw new ProviderRejectedError("ai.provider_http_403"); });
    const b = fake("b", ok());
    const { router } = make({ a, b }, { rows: [row("a", "primary"), row("b", "reserve")] }, { failureThreshold: 1 });
    for (let i = 0; i < 4; i++) await router.execute(input);
    expect(a.calls).toBe(4); // continua tentando o principal
    const c = fake("c", () => { throw new ProviderRejectedError("ai.provider_http_401"); });
    const { router: r2 } = make({ c, b }, { rows: [row("c", "primary"), row("b", "reserve")] }, { failureThreshold: 1 });
    for (let i = 0; i < 4; i++) await r2.execute(input);
    expect(c.calls).toBe(1); // chave recusada (401) abre o disjuntor
  });

  it("estouro no calculo de custo nao gera segunda chamada paga", async () => {
    const a = fake("a", () => ({ text: "x", tokensIn: Number.MAX_SAFE_INTEGER, tokensOut: 1 })); const b = fake("b", ok());
    const { router, source } = make({ a, b }, { rows: [row("a", "primary"), row("b", "reserve")] });
    const r = await router.execute(input);
    expect(r.providerId).toBe("a");
    expect(b.calls).toBe(0);
    expect(source.usage[0]!.costMicroMinor).toBe(Number.MAX_SAFE_INTEGER);
  });
});
