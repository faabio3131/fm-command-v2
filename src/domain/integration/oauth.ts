/**
 * OAuth 2.0 (código de autorização) dos conectores. O provedor é um descritor
 * de dados; o fluxo é o mesmo para todos. Valores marcados como "não conferido"
 * vêm de documentação de terceiros e só valem depois do teste com app real.
 */
export interface OAuthProviderConfig {
  readonly id: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  /** Onde vão o client_id e o client_secret no pedido de token. */
  readonly clientAuth: "basic" | "body";
  readonly usesPkce: boolean;
  readonly scopes: readonly string[];
  /** O provedor lê os parâmetros depois de `#` (ex.: Conta Azul: `.../#/oauth/authorize?...`). */
  readonly queryInFragment?: boolean;
}

export class OAuthProviderNotConfiguredError extends Error {
  constructor() {
    super("integration.oauth_provider_not_configured");
    this.name = "OAuthProviderNotConfiguredError";
  }
}

export class OAuthStateInvalidError extends Error {
  constructor() {
    super("integration.oauth_state_invalid");
    this.name = "OAuthStateInvalidError";
  }
}

export interface OAuthStateRecord {
  readonly tenantId: string;
  readonly userId: string;
  readonly sourceId: string;
  readonly providerId: string;
  readonly codeVerifier?: string;
}

export interface OAuthStateStore {
  create(input: OAuthStateRecord & { state: string; expiresAt: Date }): Promise<void>;
  /** Uso único: devolve o registro e o consome; segunda chamada (ou expirado) devolve null. */
  consume(state: string): Promise<OAuthStateRecord | null>;
}
