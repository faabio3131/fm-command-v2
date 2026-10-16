import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import { RateLimiter, type Clock } from "@/application/integration/rate-limiter";
import {
  ConnectorAuthError,
  ConnectorConfigError,
  ConnectorRateLimitedError,
  type CanonicalFactRepository,
  type SourceDefinition,
  type SourceRepository,
  type SyncRepository,
} from "@/domain/integration/contracts";
import { CredentialNotFoundError } from "@/domain/integration/credentials";
import type { TenantContext } from "@/domain/security/tenant-context";
import { OmieClient } from "@/infrastructure/connectors/omie/omie-client";
import { OmieConnector } from "@/infrastructure/connectors/omie/omie-connector";
import { mapOmieRecord, parseOmieDate, toMinorUnits } from "@/infrastructure/connectors/omie/omie-mapping";
import { InMemoryCredentialStore, OmieSimulator, receivable } from "./support/omie-simulator";

const UNIT_UUID = "11111111-1111-4111-8111-111111111111";
const ctxA: TenantContext = { tenantId: "empresa-a", userId: "u-a", role: "owner", correlationId: "c-a" };
const ctxB: TenantContext = { tenantId: "empresa-b", userId: "u-b", role: "owner", correlationId: "c-b" };
const SECRET_A = "segredo-da-empresa-a-1234567890";
const SECRET_B = "segredo-da-empresa-b-0987654321";

function source(tenantId: string, over: Partial<SourceDefinition> = {}): SourceDefinition {
  return {
    id: `src-${tenantId}`, tenantId, name: "Omie", sourceType: "omie", authoritativeDomain: "finance",
    status: "configured", syncMode: "pull", config: {}, mappingVersion: "omie.v1", secretRef: `vault:omie-${tenantId}`, ...over,
  };
}

const fakeClock = (start = Date.parse("2026-10-16T12:00:00Z")) => {
  let t = start;
  const clock: Clock = { now: () => t, sleep: async (ms) => { t += ms; } };
  return { clock, advance: (ms: number) => { t += ms; }, get: () => t };
};

function setup(opts: { sources?: SourceDefinition[]; limiterClock?: Clock } = {}) {
  const sim = new OmieSimulator();
  sim.accounts.set("KEY-A", { appSecret: SECRET_A, receivables: [], payables: [] });
  sim.accounts.set("KEY-B", { appSecret: SECRET_B, receivables: [], payables: [] });
  const creds = new InMemoryCredentialStore();
  creds.set("empresa-a", "vault:omie-empresa-a", { kind: "api_key_pair", appKey: "KEY-A", appSecret: SECRET_A });
  creds.set("empresa-b", "vault:omie-empresa-b", { kind: "api_key_pair", appKey: "KEY-B", appSecret: SECRET_B });
  const fc = fakeClock();
  const limiter = new RateLimiter(opts.limiterClock ?? fc.clock);
  const connector = new OmieConnector(new OmieClient(sim, limiter), creds, fc.clock);
  const sources = opts.sources ?? [source("empresa-a"), source("empresa-b")];
  const repo: SourceRepository = {
    async findById(tenantId, id) { return sources.find((s) => s.tenantId === tenantId && s.id === id) ?? null; },
    async list(tenantId) { return sources.filter((s) => s.tenantId === tenantId); },
    async create() { throw new Error("n/a"); },
  };
  const ingested: Parameters<CanonicalFactRepository["ingest"]>[0][] = [];
  const failures: string[] = [];
  const syncs: SyncRepository = {
    async begin() { return { id: `exec-${Math.random()}`, state: "started" as const }; },
    async complete() {},
    async fail(i) { failures.push(`${i.errorCode}:${i.errorMessage}`); },
  };
  const runtime = new ConnectorRuntime(repo, syncs, { async ingest(i) { ingested.push(i); } }, [connector], 5_000, 3, 0);
  return { sim, creds, connector, runtime, ingested, failures, fc, sources };
}

const sync = (rt: ConnectorRuntime, ctx: TenantContext, cursor?: string) =>
  rt.syncPull(ctx, { sourceId: `src-${ctx.tenantId}`, cursor, idempotencyKey: `k-${Math.random()}` });

let output: string[];
beforeEach(() => {
  output = [];
  for (const m of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { output.push(a.map(String).join(" ")); });
  }
});
afterEach(() => vi.restoreAllMocks());

describe("8E mapeamento: ausente nunca é zero", () => {
  const opts = { currency: "BRL", utcOffsetMinutes: -180, retrievedAt: new Date("2026-10-16T12:00:00Z") };

  it("valor ausente fica fora do fato e listado como indisponível", () => {
    const fact = mapOmieRecord("receivable", { codigo_lancamento_omie: 7 }, opts)!;
    expect(fact.payload).not.toHaveProperty("amountMinor");
    expect(fact.payload.unavailable).toEqual(expect.arrayContaining(["amountMinor", "dueDate", "status", "counterpartyRef"]));
    expect(fact.payload.timestampBasis).toBe("retrieved_at");
  });

  it("zero informado pelo Omie continua sendo zero", () => {
    const fact = mapOmieRecord("receivable", receivable(1, { valor_documento: 0 }), opts)!;
    expect(fact.payload.amountMinor).toBe(0);
    expect(fact.payload.unavailable).toBeUndefined();
  });

  it("converte para a menor unidade sem erro de ponto flutuante", () => {
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(toMinorUnits("1234,56")).toBe(123456);
    expect(toMinorUnits(null)).toBeUndefined();
    expect(toMinorUnits("abc")).toBeUndefined();
  });

  it("rejeita data impossível e aplica o fuso do Omie", () => {
    expect(parseOmieDate("31/02/2026", undefined, -180)).toBeUndefined();
    expect(parseOmieDate("05/10/2026", "10:30:00", -180)?.toISOString()).toBe("2026-10-05T13:30:00.000Z");
  });

  it("valor vazio ou em formato estranho não vira zero", () => {
    for (const bad of ["", "   ", "0x10", "1e3", "12abc"]) expect(toMinorUnits(bad)).toBeUndefined();
    const fact = mapOmieRecord("receivable", receivable(3, { valor_documento: "" }), opts)!;
    expect(fact.payload).not.toHaveProperty("amountMinor");
    expect(fact.payload.unavailable).toContain("amountMinor");
  });

  it("o mesmo número em receber e pagar gera fatos distintos", () => {
    const a = mapOmieRecord("receivable", receivable(5), opts)!;
    const b = mapOmieRecord("payable", receivable(5), opts)!;
    expect(a.externalId).not.toBe(b.externalId);
  });

  it("sem data de alteração vale a leitura mais recente, não a data de emissão", () => {
    const fact = mapOmieRecord("receivable", receivable(6, { info: {} }), opts)!;
    expect(fact.payload.timestampBasis).toBe("retrieved_at");
    expect(fact.sourceTimestamp).toEqual(opts.retrievedAt);
  });

  it("registro sem identificador não vira fato", () => {
    expect(mapOmieRecord("payable", { valor_documento: 10 }, opts)).toBeUndefined();
  });

  it("status desconhecido não é inventado", () => {
    const fact = mapOmieRecord("receivable", receivable(2, { status_titulo: "XYZ" }), opts)!;
    expect(fact.payload).not.toHaveProperty("status");
    expect(fact.payload.sourceStatus).toBe("XYZ");
    expect(fact.payload.unavailable).toContain("status");
  });
});

describe("8E conector Omie", () => {
  it("lê o ciclo completo paginando (100 por página) e depois fica incremental", async () => {
    const { sim, runtime, ingested } = setup();
    sim.accounts.get("KEY-A")!.receivables = Array.from({ length: 250 }, (_, i) => receivable(i + 1));
    sim.accounts.get("KEY-A")!.payables = [receivable(9001)];
    let cursor: string | undefined;
    let pulls = 0;
    do {
      const r = await sync(runtime, ctxA, cursor);
      cursor = r.nextCursor;
      pulls += 1;
    } while (JSON.parse(cursor!).since === undefined && pulls < 20);
    expect(pulls).toBe(4); // 3 páginas a receber + 1 a pagar
    expect(ingested).toHaveLength(251);
    expect(ingested.filter((i) => i.fact.factType === "finance.payable")).toHaveLength(1);
    expect(JSON.parse(cursor!)).toMatchObject({ s: "receivable", p: 1, since: "2026-10-16" });
    expect(sim.calls.every((c) => c.param.registros_por_pagina === 100)).toBe(true);
    expect(sim.calls[0].url).toBe("https://app.omie.com.br/api/v1/financeiro/contareceber/");
  });

  it("no ciclo incremental pede só o que mudou", async () => {
    const { sim, runtime, ingested } = setup();
    sim.accounts.get("KEY-A")!.receivables = [
      receivable(1, { info: { dAlt: "01/01/2026" } }),
      receivable(2, { info: { dAlt: "16/10/2026" } }),
    ];
    const r = await sync(runtime, ctxA, JSON.stringify({ s: "receivable", p: 1, since: "2026-10-16" }));
    expect(r.ingested).toBe(1);
    expect(ingested[0].fact.externalId).toBe("receivable:2");
    expect(sim.calls[0].param).toMatchObject({ filtrar_apenas_alteracao: "S", filtrar_por_data_de: "15/10/2026" });
  });

  it("página sem registros avança em vez de falhar", async () => {
    const { runtime } = setup();
    const r = await sync(runtime, ctxA);
    expect(r).toMatchObject({ status: "completed", ingested: 0 });
    expect(JSON.parse(r.nextCursor!)).toMatchObject({ s: "payable", p: 1 });
  });

  it("cursor adulterado é recusado sem chamar o Omie", async () => {
    const { sim, runtime } = setup();
    for (const bad of ["lixo", JSON.stringify({ s: "../x", p: 1 }), JSON.stringify({ s: "payable", p: -5 }), JSON.stringify({ s: "payable", p: 1, since: "ontem" }), JSON.stringify({ s: "payable", p: 1, since: "9999-99-99" })]) {
      await expect(sync(runtime, ctxA, bad)).rejects.toBeInstanceOf(ConnectorConfigError);
    }
    expect(sim.calls).toHaveLength(0);
  });

  it("unidade de origem só entra se estiver no mapa da fonte", async () => {
    const mapped = source("empresa-a", { config: { unitRefField: "codigo_departamento", unitMap: { D1: UNIT_UUID, D2: "nao-e-uuid" } } });
    const { sim, runtime, ingested } = setup({ sources: [mapped, source("empresa-b")] });
    sim.accounts.get("KEY-A")!.receivables = [
      receivable(1, { codigo_departamento: "D1" }), receivable(2, { codigo_departamento: "D2" }),
      receivable(3, { codigo_departamento: "D9" }), receivable(4),
    ];
    await sync(runtime, ctxA);
    expect(ingested.map((i) => i.unitId)).toEqual([UNIT_UUID, undefined, undefined, undefined]);
  });

  it("limites da fonte só podem baixar o teto do Omie, nunca subir", async () => {
    const greedy = source("empresa-a", { config: { limits: { requestsPerMinute: 9999, maxConcurrent: 99 } } });
    const { sim, runtime } = setup({ sources: [greedy, source("empresa-b")] });
    sim.accounts.get("KEY-A")!.receivables = [receivable(1)];
    sim.latencyMs = 5;
    await Promise.all(Array.from({ length: 8 }, () => sync(runtime, ctxA)));
    expect(sim.maxActive).toBeLessThanOrEqual(4);
  });
});

describe("8E erros e limites", () => {
  it("chave errada: falha de autenticação, sem repetir, e saúde indisponível", async () => {
    const { sim, creds, runtime, failures } = setup();
    creds.set("empresa-a", "vault:omie-empresa-a", { kind: "api_key_pair", appKey: "KEY-A", appSecret: "errado" });
    await expect(sync(runtime, ctxA)).rejects.toBeInstanceOf(ConnectorAuthError);
    expect(sim.calls).toHaveLength(1);
    expect(failures[0]).toBe("ConnectorAuthError:integration.connector_auth_error");
    expect(await runtime.health(ctxA, "src-empresa-a")).toBe("unavailable");
  });

  it("bloqueio 425 não é repetido na hora", async () => {
    const { sim, runtime } = setup();
    sim.queue = ["block_425", "block_425", "block_425"];
    await expect(sync(runtime, ctxA)).rejects.toBeInstanceOf(ConnectorRateLimitedError);
    expect(sim.calls).toHaveLength(1);
  });

  it("falha de rede ou 503 é repetida e se recupera", async () => {
    const { sim, runtime } = setup();
    sim.accounts.get("KEY-A")!.receivables = [receivable(1)];
    sim.queue = ["transport_error", "http_503"];
    const r = await sync(runtime, ctxA);
    expect(r).toMatchObject({ status: "completed", ingested: 1 });
    expect(sim.calls).toHaveLength(3);
  });

  it("limitador respeita 240/min: acima disso falha antes de chamar, sem deixar chamada órfã", async () => {
    const fc = fakeClock();
    const { sim, runtime } = setup({ limiterClock: fc.clock });
    sim.now = fc.get;
    sim.accounts.get("KEY-A")!.receivables = [receivable(1)];
    const cursor = JSON.stringify({ s: "receivable", p: 1 });
    for (let i = 0; i < 240; i += 1) await sync(runtime, ctxA, cursor);
    await expect(sync(runtime, ctxA, cursor)).rejects.toBeInstanceOf(ConnectorRateLimitedError);
    expect(sim.calls).toHaveLength(240); // nenhuma chamada além do teto
    fc.advance(61_000);
    await expect(sync(runtime, ctxA, cursor)).resolves.toMatchObject({ status: "completed" });
  });

  it("o limitador espera a janela quando não há prazo (uso direto)", async () => {
    const fc = fakeClock();
    const limiter = new RateLimiter(fc.clock);
    const t0 = fc.get();
    for (let i = 0; i < 3; i += 1) await limiter.run("k", { requestsPerMinute: 2, maxConcurrent: 1 }, async () => i);
    expect(fc.get() - t0).toBeGreaterThanOrEqual(60_000);
  });

  it("fila de espera limitada: não cresce sem fim", async () => {
    const limiter = new RateLimiter();
    const limits = { requestsPerMinute: 1000, maxConcurrent: 1 };
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = limiter.run("k", limits, () => gate);
    const waiting = Array.from({ length: 100 }, () => limiter.run("k", limits, async () => 1));
    await expect(limiter.run("k", limits, async () => 1)).rejects.toThrow("integration.rate_limit_wait_exceeded");
    release();
    await Promise.all([first, ...waiting]);
  });

  it("resposta ok sem a lista esperada é erro de contrato, não 'sem registros'", async () => {
    const { sim, runtime } = setup();
    const original = sim.post.bind(sim);
    sim.post = async (url: string, body: unknown) => {
      await original(url, body);
      return { status: 200, body: { pagina: 1, total_de_paginas: 1 } };
    };
    await expect(sync(runtime, ctxA)).rejects.toBeInstanceOf(ConnectorConfigError);
  });

  it("fonte sem referência de credencial falha por configuração", async () => {
    const { runtime } = setup({ sources: [source("empresa-a", { secretRef: undefined }), source("empresa-b")] });
    await expect(sync(runtime, ctxA)).rejects.toBeInstanceOf(ConnectorConfigError);
  });
});

describe("8E isolamento entre empresas e segredo", () => {
  it("empresa A nunca lê a fonte da empresa B", async () => {
    const { sim, runtime } = setup();
    await expect(runtime.syncPull(ctxA, { sourceId: "src-empresa-b", idempotencyKey: "x" })).rejects.toThrow("security.cross_tenant_access_denied");
    expect(sim.calls).toHaveLength(0);
  });

  it("referência de credencial de outra empresa não resolve", async () => {
    const stolen = source("empresa-a", { secretRef: "vault:omie-empresa-b" });
    const { sim, runtime } = setup({ sources: [stolen, source("empresa-b")] });
    await expect(sync(runtime, ctxA)).rejects.toBeInstanceOf(CredentialNotFoundError);
    expect(sim.calls).toHaveLength(0);
  });

  it("cada empresa usa a própria chave e só enxerga os próprios dados", async () => {
    const { sim, runtime, ingested } = setup();
    sim.accounts.get("KEY-A")!.receivables = [receivable(1)];
    sim.accounts.get("KEY-B")!.receivables = [receivable(2), receivable(3)];
    await sync(runtime, ctxA);
    await sync(runtime, ctxB);
    expect(sim.calls.map((c) => c.appKey)).toEqual(["KEY-A", "KEY-B"]);
    expect(ingested.filter((i) => i.tenantId === "empresa-a").map((i) => i.fact.externalId)).toEqual(["receivable:1"]);
    expect(ingested.filter((i) => i.tenantId === "empresa-b").map((i) => i.fact.externalId)).toEqual(["receivable:2", "receivable:3"]);
  });

  it("o limite é por empresa: o consumo de A não atrasa B", async () => {
    const fc = fakeClock();
    const { sim, runtime } = setup({ limiterClock: fc.clock });
    sim.now = fc.get;
    sim.accounts.get("KEY-A")!.receivables = [receivable(1)];
    sim.accounts.get("KEY-B")!.receivables = [receivable(2)];
    for (let i = 0; i < 240; i += 1) await sync(runtime, ctxA, JSON.stringify({ s: "receivable", p: 1 }));
    const before = fc.get();
    await sync(runtime, ctxB, JSON.stringify({ s: "receivable", p: 1 }));
    expect(fc.get()).toBe(before);
  });

  it("o segredo nunca aparece em erro, registro de falha ou log", async () => {
    const { sim, creds, runtime, failures } = setup();
    creds.set("empresa-a", "vault:omie-empresa-a", { kind: "api_key_pair", appKey: "KEY-A", appSecret: SECRET_B });
    let thrown: unknown;
    try { await sync(runtime, ctxA); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ConnectorAuthError);
    const everything = [String((thrown as Error).message), (thrown as Error).stack ?? "", ...failures, ...output].join("\n");
    for (const secret of [SECRET_A, SECRET_B]) expect(everything).not.toContain(secret);
    expect(sim.calls).toHaveLength(1);
  });
});
