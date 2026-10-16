import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { OAuthClient } from "@/application/integration/oauth-client";
import { OAuthConnectionService } from "@/application/integration/oauth-connection-service";
import { OAuthTokenService } from "@/application/integration/oauth-token-service";
import { CredentialNotFoundError } from "@/domain/integration/credentials";
import type { OAuthProviderConfig } from "@/domain/integration/oauth";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { oauthStates, sourceCredentials } from "@/infrastructure/db/credential-schema";
import { sourceDefinitions } from "@/infrastructure/db/platform-schema";
import { PostgresCredentialStore } from "@/infrastructure/integration/postgres-credential-store";
import { PostgresOAuthStateStore } from "@/infrastructure/integration/postgres-oauth-state-store";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { OAuthSimulator } from "./support/oauth-simulator";

const A = "oauth-8e-a";
const B = "oauth-8e-b";
const KEY = randomBytes(32);
const creds = new PostgresCredentialStore(() => KEY);
const states = new PostgresOAuthStateStore(() => KEY);
const sources = new PostgresSourceRepository();
const provider: OAuthProviderConfig = {
  id: "conta_azul", authorizeUrl: "https://auth.exemplo.test/login", tokenUrl: "https://auth.exemplo.test/token",
  clientAuth: "basic", usesPkce: true, scopes: ["openid"],
};
const ctx = (tenantId: string, userId = "u1"): TenantContext => ({ tenantId, userId, role: "owner", correlationId: "c" });

async function cleanup() {
  const t = [A, B];
  await db.delete(oauthStates).where(inArray(oauthStates.tenantId, t));
  await db.delete(sourceCredentials).where(inArray(sourceCredentials.tenantId, t));
  await db.delete(sourceDefinitions).where(inArray(sourceDefinitions.tenantId, t));
}
beforeAll(cleanup);
afterAll(cleanup);

describe("8E OAuth no Postgres", () => {
  it("state: uso único, expira, e o verificador PKCE não fica legível", async () => {
    await states.create({ state: "st-1", tenantId: A, userId: "u1", sourceId: "11111111-1111-4111-8111-111111111111", providerId: "conta_azul", codeVerifier: "VERIFICADOR-LEGIVEL", expiresAt: new Date(Date.now() + 60_000) });
    const rows = await db.select().from(oauthStates).where(eq(oauthStates.tenantId, A));
    expect(JSON.stringify(rows)).not.toContain("VERIFICADOR-LEGIVEL");
    expect(JSON.stringify(rows)).not.toContain("st-1");
    const [first, second] = await Promise.all([states.consume("st-1"), states.consume("st-1")]);
    expect([first, second].filter(Boolean)).toHaveLength(1); // corrida: só um passa
    expect((first ?? second)?.codeVerifier).toBe("VERIFICADOR-LEGIVEL");
    expect(await states.consume("st-1")).toBeNull();
    expect(await states.consume("nunca-existiu")).toBeNull();
    await states.create({ state: "st-old", tenantId: A, userId: "u1", sourceId: "11111111-1111-4111-8111-111111111111", providerId: "conta_azul", expiresAt: new Date(Date.now() - 1000) });
    expect(await states.consume("st-old")).toBeNull();
  });

  it("renovação com trava no banco: 6 chamadas simultâneas gastam o refresh token uma vez", async () => {
    const sim = new OAuthSimulator();
    sim.latencyMs = 25;
    sim.refreshTokens.add("r0");
    await creds.save(A, "vault:lock", { kind: "oauth2", accessToken: "velho", refreshToken: "r0", expiresAt: new Date(Date.now() - 1000) });
    const service = new OAuthTokenService(creds, new OAuthClient(sim));
    const client = { clientId: sim.clientId, clientSecret: sim.clientSecret };
    const tokens = await Promise.all(Array.from({ length: 6 }, () => service.accessToken(A, "vault:lock", provider, client, 2000)));
    expect(new Set(tokens)).toEqual(new Set(["access-1"]));
    expect(sim.requests).toHaveLength(1);
    const stored = await creds.resolve(A, "vault:lock");
    expect(stored).toMatchObject({ kind: "oauth2", accessToken: "access-1", refreshToken: "refresh-1" });
    // o token no banco não é legível
    const [row] = await db.select().from(sourceCredentials).where(eq(sourceCredentials.secretRef, "vault:lock"));
    expect(JSON.stringify(row)).not.toContain("access-1");
  });

  it("falha na renovação não apaga nem altera a credencial guardada", async () => {
    const sim = new OAuthSimulator(); // sem refresh tokens válidos
    await creds.save(A, "vault:fail", { kind: "oauth2", accessToken: "velho", refreshToken: "revogado", expiresAt: new Date(Date.now() - 1000) });
    const service = new OAuthTokenService(creds, new OAuthClient(sim));
    await expect(service.accessToken(A, "vault:fail", provider, { clientId: sim.clientId, clientSecret: sim.clientSecret }, 1000)).rejects.toThrow("integration.oauth_grant_rejected");
    expect(await creds.resolve(A, "vault:fail")).toMatchObject({ accessToken: "velho", refreshToken: "revogado" });
  });

  it("outra empresa não renova nem lê o token", async () => {
    const sim = new OAuthSimulator();
    const service = new OAuthTokenService(creds, new OAuthClient(sim));
    await expect(service.accessToken(B, "vault:lock", provider, { clientId: "x", clientSecret: "y" }, 1000)).rejects.toBeInstanceOf(CredentialNotFoundError);
    expect(sim.requests).toHaveLength(0);
  });

  it("ponta a ponta com Postgres: start → complete grava credencial cifrada e liga a fonte", async () => {
    const sim = new OAuthSimulator();
    const source = await sources.create(A, { name: "CA", sourceType: "conta_azul", authoritativeDomain: "finance", syncMode: "pull" });
    const service = new OAuthConnectionService({
      sources, states, credentials: creds, client: new OAuthClient(sim),
      provider: () => provider, clientCredentials: () => ({ clientId: sim.clientId, clientSecret: sim.clientSecret }),
      redirectUri: "https://v2.test/api/oauth/callback",
    });
    const { authorizeUrl } = await service.start(ctx(A), source.id);
    const url = new URL(authorizeUrl);
    sim.issueCode("cod", url.searchParams.get("code_challenge")!);
    await expect(service.complete(ctx(B), { code: "cod", state: url.searchParams.get("state")! })).rejects.toThrow("integration.oauth_state_invalid");
    // o state foi queimado pela tentativa da outra empresa: recomeçar
    const again = new URL((await service.start(ctx(A), source.id)).authorizeUrl);
    sim.issueCode("cod2", again.searchParams.get("code_challenge")!);
    await service.complete(ctx(A), { code: "cod2", state: again.searchParams.get("state")! });
    expect(await creds.resolve(A, `vault:source-${source.id}`)).toMatchObject({ kind: "oauth2", accessToken: "access-1" });
    expect((await sources.findById(A, source.id))?.secretRef).toBe(`vault:source-${source.id}`);
  });
});
