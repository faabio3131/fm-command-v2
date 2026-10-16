import { beforeEach, describe, expect, it } from "vitest";
import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import { RateLimiter } from "@/application/integration/rate-limiter";
import {
  ConnectorAuthError,
  ConnectorConfigError,
  ConnectorRateLimitedError,
  type CanonicalFactRepository,
  type SourceDefinition,
  type SourceRepository,
  type SyncRepository,
} from "@/domain/integration/contracts";
import { ConnectorDefinitionError, validateConnectorDefinition } from "@/domain/integration/connector-definition";
import { CredentialNotFoundError, type ConnectorCredential } from "@/domain/integration/credentials";
import type { LockingCredentialStore } from "@/application/integration/oauth-token-service";
import type { TenantContext } from "@/domain/security/tenant-context";
import { connectorCatalog, declarativeDefinitions, registerConnectorDefinition } from "@/infrastructure/connectors/catalog";
import { DeclarativeRestConnector } from "@/infrastructure/connectors/declarative/declarative-connector";
import { getPath } from "@/infrastructure/connectors/declarative/json-path";
import { InMemoryCredentialStore } from "./support/omie-simulator";
import { RestSimulator, rec, syntheticDefinition } from "./support/rest-simulator";

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(syntheticDefinition));
/** Altera um ponto da definição por caminho ("streams.0.path") sem abrir mão da tipagem. */
function setAt(root: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let node: unknown = root;
  for (const k of keys.slice(0, -1)) node = (node as Record<string, unknown>)[k];
  (node as Record<string, unknown>)[keys[keys.length - 1]] = value;
}
const ctx = (tenantId: string): TenantContext => ({ tenantId, userId: "u", role: "owner", correlationId: "c" });

describe("8E definição declarativa: validação", () => {
  it("aceita a definição sintética e todo o catálogo versionado", () => {
    expect(validateConnectorDefinition(syntheticDefinition).streams).toHaveLength(2);
    expect(declarativeDefinitions().length).toBeGreaterThanOrEqual(4);
    expect(connectorCatalog().find((e) => e.id === "omie")).toMatchObject({ status: "ready", kind: "code" });
    for (const id of ["conta_azul", "bling", "xero", "quickbooks"]) {
      expect(connectorCatalog().find((e) => e.id === id)).toMatchObject({ status: "planned", authType: "oauth2" });
    }
  });

  const bad: Array<[string, string, unknown]> = [
    ["http sem TLS", "baseUrl", "http://api.test"],
    ["credencial na URL", "baseUrl", "https://user:pw@api.test"],
    ["consulta na base", "baseUrl", "https://api.test?x=1"],
    ["caminho para outro host", "streams.0.path", "//evil.test/x"],
    ["caminho com ..", "streams.0.path", "/v1/../admin"],
    ["caminho com esquema", "streams.0.path", "/v1/https://evil"],
    ["variável não declarada", "streams.0.path", "/v1/{outra}/x"],
    ["variável na consulta não declarada", "streams.0.query", { a: "{zzz}" }],
    ["autenticação desconhecida", "auth", { type: "basic" }],
    ["cabeçalho com quebra de linha", "auth", { type: "api_key", header: "x-api-key\nx-evil: 1" }],
    ["fluxos repetidos", "streams.1.name", "receivables"],
    ["pronto sem fluxo", "streams", []],
    ["status inválido no mapa", "streams.0.fields.status.map", { A: "pago" }],
    ["id inválido", "id", "Omie; DROP"],
    ["tipo de campo desconhecido", "streams.0.fields.amount.type", "float"],
    ["tamanho de página absurdo", "streams.0.pagination.size", 1_000_000],
    ["limite absurdo", "limits.requestsPerMinute", 10_000_000],
    ["chaves desbalanceadas", "streams.0.path", "/v1/{accountId/x"],
  ];
  for (const [name, path, value] of bad) {
    it(`recusa: ${name}`, () => {
      const d = clone();
      setAt(d, path, value);
      expect(() => validateConnectorDefinition(d)).toThrow(ConnectorDefinitionError);
    });
  }

  it("não permite redefinir um conector existente nem o Omie", () => {
    expect(() => registerConnectorDefinition({ ...clone(), id: "omie" })).toThrow("integration.connector_definition_duplicate");
    expect(() => registerConnectorDefinition({ ...clone(), id: "bling" })).toThrow("integration.connector_definition_duplicate");
  });

  it("caminho pontilhado não atravessa protótipos", () => {
    expect(getPath({ a: { b: [10, 20] } }, "a.b.1")).toBe(20);
    expect(getPath({}, "__proto__")).toBeUndefined();
    expect(getPath({}, "constructor.name")).toBeUndefined();
    expect(getPath({ a: [1] }, "a.length")).toBeUndefined();
  });
});

function setup(over: { sources?: SourceDefinition[]; limiter?: RateLimiter } = {}) {
  const sim = new RestSimulator();
  sim.accounts.set("conta-a", { receivables: [], payables: [] });
  sim.accounts.set("conta-b", { receivables: [], payables: [] });
  const creds = new InMemoryCredentialStore();
  creds.set("empresa-a", "vault:a", { kind: "api_key", apiKey: "chave-valida" });
  creds.set("empresa-b", "vault:b", { kind: "api_key", apiKey: "chave-valida" });
  const connector = new DeclarativeRestConnector(validateConnectorDefinition(syntheticDefinition), {
    transport: sim, limiter: over.limiter ?? new RateLimiter(), credentials: creds, clock: { now: () => Date.parse("2026-10-16T12:00:00Z"), sleep: async () => {} },
  });
  const src = (tenantId: string, account: string, extra: Partial<SourceDefinition> = {}): SourceDefinition => ({
    id: `src-${tenantId}`, tenantId, name: "ERP", sourceType: "erp_sintetico", authoritativeDomain: "finance", status: "configured",
    syncMode: "pull", mappingVersion: "v1", secretRef: `vault:${tenantId.slice(-1)}`, config: { variables: { accountId: account }, currency: "BRL" }, ...extra,
  });
  const sources = over.sources ?? [src("empresa-a", "conta-a"), src("empresa-b", "conta-b")];
  const repo: SourceRepository = {
    async findById(t, id) { return sources.find((s) => s.tenantId === t && s.id === id) ?? null; },
    async list(t) { return sources.filter((s) => s.tenantId === t); },
    async create() { throw new Error("n/a"); },
  };
  const ingested: Parameters<CanonicalFactRepository["ingest"]>[0][] = [];
  const syncs: SyncRepository = {
    async begin() { return { id: `e-${Math.random()}`, state: "started" as const }; },
    async complete() {}, async fail() {},
  };
  const runtime = new ConnectorRuntime(repo, syncs, { async ingest(i) { ingested.push(i); } }, [connector], 5_000, 3, 0);
  const sync = (t: string, cursor?: string) => runtime.syncPull(ctx(t), { sourceId: `src-${t}`, cursor, idempotencyKey: `k${Math.random()}` });
  return { sim, creds, runtime, ingested, sync, src, connector };
}

describe("8E motor declarativo: leitura", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });

  it("percorre os dois fluxos (página e offset) e fecha o ciclo em modo incremental", async () => {
    s.sim.accounts.get("conta-a")!.receivables = [rec(1), rec(2), rec(3)];
    s.sim.accounts.get("conta-a")!.payables = [{ id: 9, amount_minor: 1234 }, { id: 10, amount_minor: 0 }, { id: 11 }];
    let cursor: string | undefined;
    let pulls = 0;
    do {
      const r = await s.sync("empresa-a", cursor);
      cursor = r.nextCursor;
      pulls += 1;
    } while (JSON.parse(cursor!).since === undefined && pulls < 20);
    expect(pulls).toBe(4); // 2 páginas a receber + 2 blocos a pagar
    expect(s.ingested.map((i) => i.fact.externalId)).toEqual(["receivables:1", "receivables:2", "receivables:3", "payables:9", "payables:10", "payables:11"]);
    expect(JSON.parse(cursor!)).toMatchObject({ s: "receivables", p: 1, since: "2026-10-16" });
    const pay = Object.fromEntries(s.ingested.filter((i) => i.fact.factType === "finance.payable").map((i) => [i.fact.externalId, i.fact.payload]));
    expect(pay["payables:9"]).toMatchObject({ amountMinor: 1234 });
    expect(pay["payables:10"]).toMatchObject({ amountMinor: 0 }); // zero informado é zero
    expect(pay["payables:11"]).not.toHaveProperty("amountMinor"); // ausente nunca é zero
    expect(pay["payables:11"].unavailable).toContain("amountMinor");
  });

  it("converte os campos configurados", async () => {
    s.sim.accounts.get("conta-a")!.receivables = [rec(1, { branch: "F1" }), rec(2, { amount: "", state: "???", due: "31/02/2026", customer: {} })];
    await s.sync("empresa-a");
    const [a, b] = s.ingested;
    expect(a.fact.payload).toMatchObject({ amountMinor: 1050, dueDate: "2026-11-20", issueDate: "2026-10-01", status: "open", counterpartyRef: "7", currency: "BRL", timestampBasis: "changed_at" });
    expect(a.fact.sourceTimestamp.toISOString()).toBe("2026-10-05T10:00:00.000Z");
    expect(a.fact.unitRef).toBe("F1");
    expect(b.fact.payload).not.toHaveProperty("amountMinor");
    expect(b.fact.payload).not.toHaveProperty("status");
    expect(b.fact.payload.unavailable).toEqual(expect.arrayContaining(["amountMinor", "dueDate", "status", "counterpartyRef"]));
  });

  it("incremental envia só o parâmetro da definição, com um dia de folga", async () => {
    s.sim.accounts.get("conta-a")!.receivables = [rec(1, { updated_at: "2026-09-01" }), rec(2, { updated_at: "2026-10-16" })];
    const r = await s.sync("empresa-a", JSON.stringify({ s: "receivables", p: 1, since: "2026-10-16" }));
    expect(r.ingested).toBe(1);
    expect(new URL(s.sim.requests[0].url).searchParams.get("updated_since")).toBe("2026-10-15");
  });

  it("monta a URL só no host da definição, com a variável no caminho", async () => {
    const t = setup({ sources: [setup().src("empresa-a", "conta.1_x-9")] });
    t.sim.accounts.set("conta.1_x-9", { receivables: [rec(1)], payables: [] });
    await t.sync("empresa-a");
    const url = new URL(t.sim.requests[0].url);
    expect(url.origin).toBe("https://api.erp-sintetico.test");
    expect(url.pathname).toBe("/v1/accounts/conta.1_x-9/receivables");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("size")).toBe("2");
  });

  it("variável com caracteres perigosos é recusada antes de chamar", async () => {
    for (const bad of ["../admin", "a/b", "a?b=1", "a#x", "", "x".repeat(65)]) {
      const t = setup({ sources: [setup().src("empresa-a", bad)] });
      await expect(t.sync("empresa-a")).rejects.toBeInstanceOf(ConnectorConfigError);
      expect(t.sim.requests).toHaveLength(0);
    }
  });

  it("erros de contrato: lista ausente, cursor inválido e fluxo desconhecido", async () => {
    s.sim.queue = ["bad_shape"];
    await expect(s.sync("empresa-a")).rejects.toBeInstanceOf(ConnectorConfigError);
    for (const bad of ["lixo", JSON.stringify({ s: "nao_existe", p: 1 }), JSON.stringify({ s: "payables", p: 0 }), JSON.stringify({ s: "receivables", p: 1, since: "9999-99-99" })]) {
      await expect(s.sync("empresa-a", bad)).rejects.toBeInstanceOf(ConnectorConfigError);
    }
  });
});

describe("8E motor declarativo: falhas, limites e isolamento", () => {
  it("401 é falha de autenticação e a saúde fica indisponível; 429 não é repetido; 503 é", async () => {
    const s = setup();
    s.sim.accounts.get("conta-a")!.receivables = [rec(1)];
    s.sim.queue = ["http_401"];
    await expect(s.sync("empresa-a")).rejects.toBeInstanceOf(ConnectorAuthError);
    s.sim.queue = ["http_401"];
    expect(await s.runtime.health(ctx("empresa-a"), "src-empresa-a")).toBe("unavailable");
    s.sim.requests.length = 0;
    s.sim.queue = ["http_429", "http_429"];
    await expect(s.sync("empresa-a")).rejects.toBeInstanceOf(ConnectorRateLimitedError);
    expect(s.sim.requests).toHaveLength(1);
    s.sim.queue = ["http_503", "transport_error"];
    await expect(s.sync("empresa-a")).resolves.toMatchObject({ status: "completed", ingested: 1 });
  });

  it("saúde: 200 é saudável", async () => {
    const s = setup();
    expect(await s.runtime.health(ctx("empresa-a"), "src-empresa-a")).toBe("healthy");
    expect(s.sim.requests[0].url).toBe("https://api.erp-sintetico.test/v1/accounts/conta-a/ping");
  });

  it("cada empresa lê só a própria conta e a credencial de uma não serve à outra", async () => {
    const s = setup();
    s.sim.accounts.get("conta-a")!.receivables = [rec(1)];
    s.sim.accounts.get("conta-b")!.receivables = [rec(2), rec(3)];
    await s.sync("empresa-a");
    await s.sync("empresa-b");
    expect(s.ingested.filter((i) => i.tenantId === "empresa-a").map((i) => i.fact.externalId)).toEqual(["receivables:1"]);
    expect(s.ingested.filter((i) => i.tenantId === "empresa-b").map((i) => i.fact.externalId)).toEqual(["receivables:2", "receivables:3"]);
    const stolen = s.src("empresa-a", "conta-a", { secretRef: "vault:b" });
    const t = setup({ sources: [stolen] });
    await expect(t.sync("empresa-a")).rejects.toBeInstanceOf(CredentialNotFoundError);
    expect(t.sim.requests).toHaveLength(0);
  });

  it("a fonte só pode baixar o limite da definição e o limitador segura as simultâneas", async () => {
    const greedy = setup().src("empresa-a", "conta-a", { config: { variables: { accountId: "conta-a" }, limits: { requestsPerMinute: 99999, maxConcurrent: 99 } } });
    const s = setup({ sources: [greedy] });
    s.sim.accounts.get("conta-a")!.receivables = [rec(1)];
    s.sim.latencyMs = 5;
    await Promise.all(Array.from({ length: 8 }, () => s.sync("empresa-a")));
    expect(s.sim.maxActive).toBeLessThanOrEqual(3);
  });

  it("segredo nunca aparece em erro nem em fato", async () => {
    const s = setup();
    s.sim.accounts.get("conta-a")!.receivables = [rec(1)];
    s.sim.validAuth = () => false;
    let err: unknown;
    try { await s.sync("empresa-a"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConnectorAuthError);
    expect(String((err as Error).message) + String((err as Error).stack)).not.toContain("chave-valida");
  });

  it("conector planejado não lê", async () => {
    const plannedRaw = clone();
    setAt(plannedRaw, "status", "planned");
    const planned = validateConnectorDefinition(plannedRaw);
    const s = setup();
    const c = new DeclarativeRestConnector(planned, { transport: s.sim, limiter: new RateLimiter(), credentials: s.creds });
    await expect(c.pull({ tenantId: "empresa-a", correlationId: "c", timeoutMs: 1000 }, s.src("empresa-a", "conta-a"))).rejects.toThrow("integration.connector_not_ready");
  });
});

describe("8E motor declarativo: OAuth", () => {
  it("renova o token vencido uma vez e envia Bearer; 401 vira falha de autenticação", async () => {
    const { OAuthClient } = await import("@/application/integration/oauth-client");
    const { OAuthTokenService } = await import("@/application/integration/oauth-token-service");
    const { OAuthSimulator } = await import("./support/oauth-simulator");
    const oauth = new OAuthSimulator();
    oauth.refreshTokens.add("r0");
    const entries = new Map<string, ConnectorCredential>([["empresa-a|vault:a", { kind: "oauth2", accessToken: "velho", refreshToken: "r0", expiresAt: new Date(Date.now() - 1000) }]]);
    const store: LockingCredentialStore = {
      async resolve(t, r) { const v = entries.get(`${t}|${r}`); if (!v) throw new CredentialNotFoundError(); return v; },
      async updateLocked(t, r, fn) { const next = await fn(await this.resolve(t, r)); entries.set(`${t}|${r}`, next); return next; },
    };
    const def = clone();
    setAt(def, "auth", { type: "oauth2", providerId: "erp_sintetico" });
    const rest = new RestSimulator();
    rest.accounts.set("conta-a", { receivables: [rec(1)], payables: [] });
    rest.validAuth = (h) => h.authorization === "Bearer access-1";
    const connector = new DeclarativeRestConnector(validateConnectorDefinition(def), {
      transport: rest, limiter: new RateLimiter(), credentials: store,
      tokens: new OAuthTokenService(store, new OAuthClient(oauth)),
      oauthProvider: () => ({ id: "erp_sintetico", authorizeUrl: "https://a.test/a", tokenUrl: "https://a.test/t", clientAuth: "basic", usesPkce: false, scopes: [] }),
      oauthClient: () => ({ clientId: oauth.clientId, clientSecret: oauth.clientSecret }),
    });
    const source: SourceDefinition = {
      id: "s", tenantId: "empresa-a", name: "x", sourceType: "erp_sintetico", authoritativeDomain: "finance", status: "configured",
      syncMode: "pull", mappingVersion: "v1", secretRef: "vault:a", config: { variables: { accountId: "conta-a" } },
    };
    const context = { tenantId: "empresa-a", correlationId: "c", timeoutMs: 4000 };
    const r1 = await connector.pull(context, source);
    const r2 = await connector.pull(context, source, r1.nextCursor);
    expect(r1.facts.length + r2.facts.length).toBeGreaterThan(0);
    expect(oauth.requests).toHaveLength(1); // renovou uma vez; a segunda chamada reaproveitou
    rest.queue = ["http_401"];
    await expect(connector.pull(context, source)).rejects.toBeInstanceOf(ConnectorAuthError);
  });
});

describe("8E correções da revisão", () => {
  it("moeda sem centavos e com 3 casas; casas a mais viram ausente", async () => {
    const { toMinorUnits } = await import("@/infrastructure/connectors/money");
    expect(toMinorUnits("1500", "JPY")).toBe(1500);
    expect(toMinorUnits("1.234", "KWD")).toBe(1234);
    expect(toMinorUnits("10.005", "USD")).toBeUndefined();
    expect(toMinorUnits("10.50", "USD")).toBe(1050);
    expect(Object.is(toMinorUnits("-0"), 0)).toBe(true);
  });
  it("variável só de pontos ou começando por ponto é recusada", async () => {
    const { VARIABLE_VALUE } = await import("@/domain/integration/connector-definition");
    expect(VARIABLE_VALUE.test("..")).toBe(false);
    expect(VARIABLE_VALUE.test(".x")).toBe(false);
    expect(VARIABLE_VALUE.test("acc-1.v2")).toBe(true);
  });
});
