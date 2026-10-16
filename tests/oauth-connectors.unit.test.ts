import { describe, expect, it } from "vitest";
import { OAuthClient, buildAuthorizeUrl, newPkcePair } from "@/application/integration/oauth-client";
import { OAuthConnectionService } from "@/application/integration/oauth-connection-service";
import { OAuthTokenService, type LockingCredentialStore } from "@/application/integration/oauth-token-service";
import {
  ConnectorAuthError,
  ConnectorConfigError,
  RetryableConnectorError,
  type SourceDefinition,
} from "@/domain/integration/contracts";
import { CredentialNotFoundError, type ConnectorCredential } from "@/domain/integration/credentials";
import {
  OAuthProviderNotConfiguredError,
  OAuthStateInvalidError,
  type OAuthProviderConfig,
  type OAuthStateRecord,
  type OAuthStateStore,
} from "@/domain/integration/oauth";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";
import { oauthClientCredentials, oauthProvider } from "@/infrastructure/connectors/oauth-providers";
import { OAuthSimulator } from "./support/oauth-simulator";

const provider = (over: Partial<OAuthProviderConfig> = {}): OAuthProviderConfig => ({
  id: "conta_azul", authorizeUrl: "https://auth.exemplo.test/login", tokenUrl: "https://auth.exemplo.test/token",
  clientAuth: "basic", usesPkce: true, scopes: ["openid", "profile"], ...over,
});
const ctx = (tenantId: string, userId = "u1", role: TenantContext["role"] = "owner"): TenantContext => ({ tenantId, userId, role, correlationId: "c" });

function setup(opts: { now?: () => number } = {}) {
  const sim = new OAuthSimulator();
  const clock = { t: Date.parse("2026-10-16T12:00:00Z") };
  const now = opts.now ?? (() => clock.t);
  sim.now = now;
  const client = new OAuthClient(sim, now);
  const client_ = { clientId: sim.clientId, clientSecret: sim.clientSecret };
  return { sim, client, clock, now, creds: client_ };
}

/** Armazém em memória com trava (uma renovação por vez por credencial). */
class MemoryLockingStore implements LockingCredentialStore {
  readonly entries = new Map<string, ConnectorCredential>();
  private chain = new Map<string, Promise<unknown>>();
  set(t: string, r: string, c: ConnectorCredential) { this.entries.set(`${t}|${r}`, c); }
  async resolve(t: string, r: string) {
    const v = this.entries.get(`${t}|${r}`);
    if (!v) throw new CredentialNotFoundError();
    return v;
  }
  async save(t: string, r: string, c: ConnectorCredential) { this.set(t, r, c); }
  async updateLocked(t: string, r: string, fn: (c: ConnectorCredential) => Promise<ConnectorCredential>) {
    const key = `${t}|${r}`;
    const run = (this.chain.get(key) ?? Promise.resolve()).then(async () => {
      const next = await fn(await this.resolve(t, r));
      this.entries.set(key, next);
      return next;
    });
    this.chain.set(key, run.catch(() => undefined));
    return run;
  }
}

describe("8E OAuth: pedido de autorização", () => {
  it("monta o endereço com state e PKCE só quando o provedor usa", () => {
    const pkce = newPkcePair();
    const url = new URL(buildAuthorizeUrl(provider(), { clientId: "cid", clientSecret: "x" }, { redirectUri: "https://v2.test/api/oauth/callback", state: "st", codeChallenge: pkce.challenge }));
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid profile");
    expect(url.toString()).not.toContain("clientSecret");
    const plain = new URL(buildAuthorizeUrl(provider({ usesPkce: false }), { clientId: "cid", clientSecret: "x" }, { redirectUri: "https://v2.test/cb", state: "st", codeChallenge: pkce.challenge }));
    expect(plain.searchParams.has("code_challenge")).toBe(false);
  });
});

describe("8E OAuth: troca e renovação de token", () => {
  it("troca o código (Basic) e confere o PKCE", async () => {
    const { sim, client, creds } = setup();
    const pkce = newPkcePair();
    sim.issueCode("cod1", pkce.challenge);
    const token = await client.exchangeCode(provider(), creds, { code: "cod1", redirectUri: "https://v2.test/cb", codeVerifier: pkce.verifier, timeoutMs: 1000 });
    expect(token).toMatchObject({ kind: "oauth2", accessToken: "access-1", refreshToken: "refresh-1" });
    expect(sim.requests[0].headers.authorization).toMatch(/^Basic /);
    expect(sim.requests[0].form.client_secret).toBeUndefined();
    // verificador errado ou código repetido: recusado
    sim.issueCode("cod2", pkce.challenge);
    await expect(client.exchangeCode(provider(), creds, { code: "cod2", redirectUri: "x", codeVerifier: "errado", timeoutMs: 1000 })).rejects.toBeInstanceOf(ConnectorAuthError);
    await expect(client.exchangeCode(provider(), creds, { code: "cod1", redirectUri: "x", codeVerifier: pkce.verifier, timeoutMs: 1000 })).rejects.toBeInstanceOf(ConnectorAuthError);
  });

  it("aceita provedor que pede client_id/client_secret no corpo", async () => {
    const { sim, client, creds } = setup();
    sim.clientAuth = "body";
    sim.issueCode("c", undefined);
    await client.exchangeCode(provider({ clientAuth: "body", usesPkce: false }), creds, { code: "c", redirectUri: "x", timeoutMs: 1000 });
    expect(sim.requests[0].form.client_id).toBe(sim.clientId);
    expect(sim.requests[0].headers.authorization).toBeUndefined();
  });

  it("sem expires_in assume vida curta; sem novo refresh token mantém o anterior", async () => {
    const { sim, client, creds, clock } = setup();
    sim.lifetimeSeconds = undefined;
    sim.rotatesRefreshToken = false;
    sim.refreshTokens.add("antigo");
    const out = await client.refresh(provider(), creds, { kind: "oauth2", accessToken: "a", refreshToken: "antigo" }, 1000);
    expect(out.refreshToken).toBe("antigo");
    expect(out.expiresAt!.getTime()).toBe(clock.t + 300_000);
  });

  it("erros do provedor viram os tipos certos e não vazam segredo", async () => {
    const { sim, client, creds } = setup();
    const call = () => client.refresh(provider(), creds, { kind: "oauth2", accessToken: "a", refreshToken: "revogado" }, 1000);
    let err: unknown;
    try { await call(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConnectorAuthError);
    expect(String((err as Error).message) + String((err as Error).stack)).not.toContain(sim.clientSecret);
    sim.queue = ["http_503"];
    await expect(call()).rejects.toBeInstanceOf(RetryableConnectorError);
    sim.queue = ["transport_error"];
    await expect(call()).rejects.toBeInstanceOf(RetryableConnectorError);
    await expect(client.refresh(provider(), creds, { kind: "oauth2", accessToken: "a" }, 1000)).rejects.toBeInstanceOf(ConnectorAuthError);
  });

  it("expires_in absurdo é limitado a 24 h e o Basic codifica caracteres especiais", async () => {
    const { sim, client, clock } = setup();
    sim.clientAuth = "basic";
    const odd = { clientId: "id:com:dois-pontos", clientSecret: "s/ç ?" };
    sim.postForm = async (_u, _f, o) => {
      expect(o.headers?.authorization).toBe(`Basic ${Buffer.from(`${encodeURIComponent(odd.clientId)}:${encodeURIComponent(odd.clientSecret)}`).toString("base64")}`);
      return { status: 200, body: { access_token: "a", expires_in: 1e15 } };
    };
    const out = await client.exchangeCode(provider(), odd, { code: "c", redirectUri: "x", timeoutMs: 1 });
    expect(out.expiresAt!.getTime()).toBe(clock.t + 24 * 3600_000);
  });

  it("resposta 200 sem access_token é erro de contrato", async () => {
    const { sim, client, creds } = setup();
    sim.postForm = async () => ({ status: 200, body: { foo: "bar" } });
    await expect(client.exchangeCode(provider(), creds, { code: "c", redirectUri: "x", timeoutMs: 1 })).rejects.toBeInstanceOf(ConnectorConfigError);
  });
});

describe("8E OAuth: token válido sob concorrência", () => {
  async function tokenSetup(expiresInMs: number) {
    const s = setup();
    const store = new MemoryLockingStore();
    s.sim.refreshTokens.add("r0");
    store.set("empresa-a", "vault:s", { kind: "oauth2", accessToken: "velho", refreshToken: "r0", expiresAt: new Date(s.clock.t + expiresInMs) });
    return { ...s, store, service: new OAuthTokenService(store, s.client, s.now) };
  }

  it("token ainda válido não chama o provedor", async () => {
    const { service, sim, creds } = await tokenSetup(10 * 60_000);
    expect(await service.accessToken("empresa-a", "vault:s", provider(), creds, 1000)).toBe("velho");
    expect(sim.requests).toHaveLength(0);
  });

  it("vencido (ou a menos de 1 minuto): renova uma vez e guarda o refresh novo", async () => {
    const { service, sim, creds, store } = await tokenSetup(30_000);
    expect(await service.accessToken("empresa-a", "vault:s", provider(), creds, 1000)).toBe("access-1");
    expect(sim.requests).toHaveLength(1);
    expect(await store.resolve("empresa-a", "vault:s")).toMatchObject({ refreshToken: "refresh-1" });
  });

  it("10 chamadas ao mesmo tempo gastam o refresh token de uso único uma só vez", async () => {
    const { service, sim, creds } = await tokenSetup(-1000);
    sim.latencyMs = 5;
    const tokens = await Promise.all(Array.from({ length: 10 }, () => service.accessToken("empresa-a", "vault:s", provider(), creds, 1000)));
    expect(new Set(tokens)).toEqual(new Set(["access-1"]));
    expect(sim.requests).toHaveLength(1);
  });

  it("no mesmo processo, chamadas simultâneas esperam uma só renovação sem nem entrar na trava", async () => {
    const { service, sim, creds, store } = await tokenSetup(-1000);
    sim.latencyMs = 5;
    let locks = 0;
    const original = store.updateLocked.bind(store);
    store.updateLocked = (...a: Parameters<typeof original>) => { locks += 1; return original(...a); };
    await Promise.all(Array.from({ length: 20 }, () => service.accessToken("empresa-a", "vault:s", provider(), creds, 1000)));
    expect(locks).toBe(1);
  });

  it("credencial de outra empresa não resolve", async () => {
    const { service, creds } = await tokenSetup(-1000);
    await expect(service.accessToken("empresa-b", "vault:s", provider(), creds, 1000)).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it("refresh revogado: falha de autenticação, sem repetir", async () => {
    const { service, sim, creds, store } = await tokenSetup(-1000);
    sim.refreshTokens.clear();
    await expect(service.accessToken("empresa-a", "vault:s", provider(), creds, 1000)).rejects.toBeInstanceOf(ConnectorAuthError);
    expect(sim.requests).toHaveLength(1);
    expect(await store.resolve("empresa-a", "vault:s")).toMatchObject({ refreshToken: "r0" }); // nada foi apagado
  });
});

describe("8E OAuth: ligação da fonte", () => {
  class MemoryStates implements OAuthStateStore {
    readonly rows = new Map<string, OAuthStateRecord & { expiresAt: Date; used: boolean }>();
    async create(i: OAuthStateRecord & { state: string; expiresAt: Date }) { this.rows.set(i.state, { ...i, used: false }); }
    async consume(state: string) {
      const r = this.rows.get(state);
      if (!r || r.used || r.expiresAt.getTime() <= now()) return null;
      r.used = true;
      return r;
    }
  }
  let nowMs = Date.parse("2026-10-16T12:00:00Z");
  const now = () => nowMs;
  const source = (tenantId: string, sourceType = "conta_azul"): SourceDefinition => ({
    id: "11111111-1111-4111-8111-111111111111", tenantId, name: "CA", sourceType, authoritativeDomain: "finance",
    status: "configured", syncMode: "pull", config: {}, mappingVersion: "v1",
  });

  function build(sources: SourceDefinition[]) {
    nowMs = Date.parse("2026-10-16T12:00:00Z");
    const s = setup({ now });
    const states = new MemoryStates();
    const store = new MemoryLockingStore();
    const attached: string[] = [];
    const service = new OAuthConnectionService({
      sources: {
        async findById(t, id) { return sources.find((x) => x.tenantId === t && x.id === id) ?? null; },
        async attachSecretRef(_t, _s, ref) { attached.push(ref); },
      },
      states, credentials: store, client: s.client,
      provider: () => provider(), clientCredentials: () => s.creds,
      redirectUri: "https://v2.test/api/oauth/callback", now,
    });
    return { ...s, states, store, service, attached };
  }
  const stateOf = (url: string) => new URL(url).searchParams.get("state")!;
  const challengeOf = (url: string) => new URL(url).searchParams.get("code_challenge")!;
  const SID = "11111111-1111-4111-8111-111111111111";

  it("fluxo completo: start → autorização → complete grava o token e liga a fonte", async () => {
    const { service, sim, store, attached } = build([source("empresa-a")]);
    const { authorizeUrl } = await service.start(ctx("empresa-a"), SID);
    sim.issueCode("codigo-1", challengeOf(authorizeUrl));
    const done = await service.complete(ctx("empresa-a"), { code: "codigo-1", state: stateOf(authorizeUrl) });
    expect(done.sourceId).toBe(SID);
    expect(await store.resolve("empresa-a", `vault:source-${SID}`)).toMatchObject({ kind: "oauth2", accessToken: "access-1" });
    expect(attached).toEqual([`vault:source-${SID}`]);
  });

  it("o retorno só vale para a empresa e o usuário que iniciaram", async () => {
    const { service, sim, store } = build([source("empresa-a"), { ...source("empresa-b"), id: "22222222-2222-4222-8222-222222222222" }]);
    const { authorizeUrl } = await service.start(ctx("empresa-a", "u1"), SID);
    sim.issueCode("c", challengeOf(authorizeUrl));
    await expect(service.complete(ctx("empresa-b", "u1"), { code: "c", state: stateOf(authorizeUrl) })).rejects.toBeInstanceOf(OAuthStateInvalidError);
    // o state foi consumido: nem o dono legítimo consegue reaproveitar
    await expect(service.complete(ctx("empresa-a", "u1"), { code: "c", state: stateOf(authorizeUrl) })).rejects.toBeInstanceOf(OAuthStateInvalidError);
    expect(store.entries.size).toBe(0);
  });

  it("outro usuário da mesma empresa não conclui o fluxo de quem iniciou", async () => {
    const { service, sim } = build([source("empresa-a")]);
    const { authorizeUrl } = await service.start(ctx("empresa-a", "u1"), SID);
    sim.issueCode("c", challengeOf(authorizeUrl));
    await expect(service.complete(ctx("empresa-a", "u2"), { code: "c", state: stateOf(authorizeUrl) })).rejects.toBeInstanceOf(OAuthStateInvalidError);
  });

  it("state repetido, expirado ou inventado é recusado", async () => {
    const { service, sim } = build([source("empresa-a")]);
    const a = await service.start(ctx("empresa-a"), SID);
    sim.issueCode("c1", challengeOf(a.authorizeUrl));
    await service.complete(ctx("empresa-a"), { code: "c1", state: stateOf(a.authorizeUrl) });
    await expect(service.complete(ctx("empresa-a"), { code: "c1", state: stateOf(a.authorizeUrl) })).rejects.toBeInstanceOf(OAuthStateInvalidError);
    const b = await service.start(ctx("empresa-a"), SID);
    nowMs += 11 * 60_000;
    await expect(service.complete(ctx("empresa-a"), { code: "c2", state: stateOf(b.authorizeUrl) })).rejects.toBeInstanceOf(OAuthStateInvalidError);
    await expect(service.complete(ctx("empresa-a"), { code: "c2", state: "inventado" })).rejects.toBeInstanceOf(OAuthStateInvalidError);
  });

  it("quem só lê não inicia nem conclui", async () => {
    const { service } = build([source("empresa-a")]);
    await expect(service.start(ctx("empresa-a", "u1", "viewer"), SID)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.complete(ctx("empresa-a", "u1", "viewer"), { code: "c", state: "s" })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("fonte de outra empresa não inicia fluxo", async () => {
    const { service } = build([source("empresa-b")]);
    await expect(service.start(ctx("empresa-a"), SID)).rejects.toThrow("integration.source_not_found");
  });
});

describe("8E OAuth: provedores", () => {
  it("endereços podem ser trocados por ambiente, só em https", () => {
    expect(oauthProvider("bling", {}).tokenUrl).toContain("bling.com.br");
    expect(oauthProvider("bling", { FMCC_OAUTH_BLING_TOKEN_URL: "https://outro.test/token" }).tokenUrl).toBe("https://outro.test/token");
    expect(() => oauthProvider("bling", { FMCC_OAUTH_BLING_TOKEN_URL: "http://inseguro.test/token" })).toThrow(OAuthProviderNotConfiguredError);
    expect(() => oauthProvider("bling", { FMCC_OAUTH_BLING_TOKEN_URL: "lixo" })).toThrow(OAuthProviderNotConfiguredError);
  });

  it("provedor desconhecido (inclusive nomes herdados do objeto) não existe", () => {
    for (const id of ["omie", "__proto__", "constructor", "toString"]) expect(() => oauthProvider(id, {})).toThrow(OAuthProviderNotConfiguredError);
  });

  it("sem o aplicativo do V2 configurado, não inicia", () => {
    expect(() => oauthClientCredentials("bling", {})).toThrow(OAuthProviderNotConfiguredError);
    expect(oauthClientCredentials("bling", { FMCC_OAUTH_BLING_CLIENT_ID: "i", FMCC_OAUTH_BLING_CLIENT_SECRET: "s" })).toEqual({ clientId: "i", clientSecret: "s" });
  });
});
