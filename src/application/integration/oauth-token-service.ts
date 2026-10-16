import { ConnectorAuthError } from "@/domain/integration/contracts";
import type { ConnectorCredential } from "@/domain/integration/credentials";
import type { OAuthProviderConfig } from "@/domain/integration/oauth";
import type { OAuthClient, OAuthClientCredentials } from "./oauth-client";

export interface LockingCredentialStore {
  resolve(tenantId: string, secretRef: string): Promise<ConnectorCredential>;
  /**
   * Lê com trava (uma renovação por vez por credencial), deixa `fn` decidir o novo valor
   * e grava. `fn` recebe o valor MAIS RECENTE já dentro da trava.
   */
  updateLocked(
    tenantId: string,
    secretRef: string,
    fn: (current: ConnectorCredential) => Promise<ConnectorCredential>,
  ): Promise<ConnectorCredential>;
}

const SKEW_MS = 60_000;

/**
 * Entrega um access token válido. O refresh token de vários provedores é de uso
 * único: duas renovações simultâneas gastariam o mesmo token e derrubariam a
 * conexão. Por isso a renovação roda dentro da trava da credencial e, ao
 * entrar, confere de novo se outro processo já renovou.
 */
export class OAuthTokenService {
  /** Chamadas simultâneas do mesmo processo para a mesma credencial esperam uma única renovação. */
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly store: LockingCredentialStore,
    private readonly client: OAuthClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  accessToken(
    tenantId: string,
    secretRef: string,
    provider: OAuthProviderConfig,
    clientCredentials: OAuthClientCredentials,
    timeoutMs: number,
  ): Promise<string> {
    const key = `${tenantId}\u0000${secretRef}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const task = this.load(tenantId, secretRef, provider, clientCredentials, timeoutMs).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async load(
    tenantId: string,
    secretRef: string,
    provider: OAuthProviderConfig,
    clientCredentials: OAuthClientCredentials,
    timeoutMs: number,
  ): Promise<string> {
    const current = await this.store.resolve(tenantId, secretRef);
    if (current.kind !== "oauth2") throw new ConnectorAuthError("integration.oauth_credential_kind_invalid");
    if (this.isFresh(current)) return current.accessToken;

    const updated = await this.store.updateLocked(tenantId, secretRef, async (latest) => {
      if (latest.kind !== "oauth2") throw new ConnectorAuthError("integration.oauth_credential_kind_invalid");
      if (this.isFresh(latest)) return latest;
      return this.client.refresh(provider, clientCredentials, latest, timeoutMs);
    });
    if (updated.kind !== "oauth2") throw new ConnectorAuthError("integration.oauth_credential_kind_invalid");
    return updated.accessToken;
  }

  private isFresh(credential: Extract<ConnectorCredential, { kind: "oauth2" }>): boolean {
    return Boolean(credential.expiresAt && credential.expiresAt.getTime() - SKEW_MS > this.now());
  }
}
