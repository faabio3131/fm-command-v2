import type { SourceRepository } from "@/domain/integration/contracts";
import type { ConnectorCredential } from "@/domain/integration/credentials";
import {
  OAuthStateInvalidError,
  type OAuthProviderConfig,
  type OAuthStateStore,
} from "@/domain/integration/oauth";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import {
  buildAuthorizeUrl,
  newPkcePair,
  newState,
  type OAuthClient,
  type OAuthClientCredentials,
} from "./oauth-client";

const STATE_TTL_MS = 10 * 60_000;

export class SourceNotFoundError extends Error {
  constructor() {
    super("integration.source_not_found");
    this.name = "SourceNotFoundError";
  }
}

export interface OAuthConnectionDeps {
  readonly sources: Pick<SourceRepository, "findById"> & {
    attachSecretRef(tenantId: string, sourceId: string, secretRef: string): Promise<void>;
  };
  readonly states: OAuthStateStore;
  readonly credentials: { save(tenantId: string, secretRef: string, credential: ConnectorCredential): Promise<void> };
  readonly client: OAuthClient;
  readonly provider: (id: string) => OAuthProviderConfig;
  readonly clientCredentials: (id: string) => OAuthClientCredentials;
  readonly redirectUri: string;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

/** Liga a conta do ERP de uma empresa ao V2 sem que o cliente copie chave nenhuma. */
export class OAuthConnectionService {
  constructor(private readonly deps: OAuthConnectionDeps) {}

  async start(context: TenantContext, sourceId: string): Promise<{ authorizeUrl: string }> {
    requirePermission(context, "source:write");
    const source = await this.deps.sources.findById(context.tenantId, sourceId);
    if (!source) throw new SourceNotFoundError();
    // Valida o provedor e o aplicativo ANTES de gravar qualquer estado.
    const provider = this.deps.provider(source.sourceType);
    const client = this.deps.clientCredentials(source.sourceType);
    const state = newState();
    const pkce = provider.usesPkce ? newPkcePair() : undefined;
    const now = (this.deps.now ?? Date.now)();
    await this.deps.states.create({
      state,
      tenantId: context.tenantId,
      userId: context.userId,
      sourceId: source.id,
      providerId: provider.id,
      codeVerifier: pkce?.verifier,
      expiresAt: new Date(now + STATE_TTL_MS),
    });
    return {
      authorizeUrl: buildAuthorizeUrl(provider, client, {
        redirectUri: this.deps.redirectUri,
        state,
        codeChallenge: pkce?.challenge,
      }),
    };
  }

  async complete(context: TenantContext, input: { code: string; state: string }): Promise<{ sourceId: string }> {
    requirePermission(context, "source:write");
    const record = await this.deps.states.consume(input.state);
    // O state precisa ter nascido para ESTA empresa e ESTE usuário.
    if (!record || record.tenantId !== context.tenantId || record.userId !== context.userId) {
      throw new OAuthStateInvalidError();
    }
    const source = await this.deps.sources.findById(context.tenantId, record.sourceId);
    if (!source || source.sourceType !== record.providerId) throw new OAuthStateInvalidError();
    const provider = this.deps.provider(record.providerId);
    const credential = await this.deps.client.exchangeCode(provider, this.deps.clientCredentials(record.providerId), {
      code: input.code,
      redirectUri: this.deps.redirectUri,
      codeVerifier: record.codeVerifier,
      timeoutMs: this.deps.timeoutMs ?? 8_000,
    });
    const secretRef = `vault:source-${source.id}`;
    await this.deps.credentials.save(context.tenantId, secretRef, credential);
    await this.deps.sources.attachSecretRef(context.tenantId, source.id, secretRef);
    return { sourceId: source.id };
  }
}
