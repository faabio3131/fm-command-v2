/**
 * Credenciais de conectores. Ficam fora do código e fora da configuração da
 * fonte: a fonte guarda só uma referência (`secretRef`); quem resolve é um
 * CredentialStore, sempre dentro do escopo da empresa.
 */
export type ConnectorCredential =
  | { readonly kind: "api_key_pair"; readonly appKey: string; readonly appSecret: string }
  | { readonly kind: "api_key"; readonly apiKey: string }
  | {
      readonly kind: "oauth2";
      readonly accessToken: string;
      readonly refreshToken?: string;
      readonly expiresAt?: Date;
    };

export class CredentialNotFoundError extends Error {
  constructor() {
    super("integration.credential_not_found");
    this.name = "CredentialNotFoundError";
  }
}

export interface CredentialStore {
  /** Lança CredentialNotFoundError se a referência não existir para esta empresa. */
  resolve(tenantId: string, secretRef: string): Promise<ConnectorCredential>;
}
