import { createHash, randomBytes } from "node:crypto";
import {
  ConnectorAuthError,
  ConnectorConfigError,
  RetryableConnectorError,
} from "@/domain/integration/contracts";
import type { ConnectorCredential } from "@/domain/integration/credentials";
import { OAuthProviderNotConfiguredError, type OAuthProviderConfig } from "@/domain/integration/oauth";
import type { JsonHttpTransport } from "@/infrastructure/connectors/http-json-transport";
import { TransportError } from "@/infrastructure/connectors/http-json-transport";

export interface OAuthClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

const base64url = (buf: Buffer) => buf.toString("base64url");

export function newPkcePair() {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

export const newState = () => base64url(randomBytes(32));

export function buildAuthorizeUrl(
  provider: OAuthProviderConfig,
  client: OAuthClientCredentials,
  input: { redirectUri: string; state: string; codeChallenge?: string },
): string {
  const params = new URLSearchParams();
  params.set("response_type", "code");
  params.set("client_id", client.clientId);
  params.set("redirect_uri", input.redirectUri);
  params.set("state", input.state);
  if (provider.scopes.length) params.set("scope", provider.scopes.join(" "));
  if (provider.usesPkce && input.codeChallenge) {
    params.set("code_challenge", input.codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  if (provider.queryInFragment) {
    // Parâmetros vão depois do `#`: a URL base precisa ter o fragmento e nenhuma consulta própria.
    if (!provider.authorizeUrl.includes("#") || provider.authorizeUrl.includes("?")) throw new OAuthProviderNotConfiguredError();
  }
  if (provider.queryInFragment) return `${provider.authorizeUrl}?${params.toString()}`;
  const url = new URL(provider.authorizeUrl);
  for (const [k, v] of params) url.searchParams.set(k, v);
  return url.toString();
}

type OAuth2Credential = Extract<ConnectorCredential, { kind: "oauth2" }>;

/** Sem `expires_in`, assume-se vida curta: melhor renovar de mais do que usar token vencido. */
const DEFAULT_LIFETIME_SECONDS = 300;
/** Teto: um `expires_in` absurdo não pode deixar o token "fresco" por anos nem gerar data inválida. */
const MAX_LIFETIME_SECONDS = 24 * 3600;

export class OAuthClient {
  constructor(
    private readonly transport: JsonHttpTransport,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async exchangeCode(
    provider: OAuthProviderConfig,
    client: OAuthClientCredentials,
    input: { code: string; redirectUri: string; codeVerifier?: string; timeoutMs: number },
  ): Promise<OAuth2Credential> {
    const form: Record<string, string> = {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    };
    if (provider.usesPkce && input.codeVerifier) form.code_verifier = input.codeVerifier;
    return this.token(provider, client, form, undefined, input.timeoutMs);
  }

  async refresh(
    provider: OAuthProviderConfig,
    client: OAuthClientCredentials,
    current: OAuth2Credential,
    timeoutMs: number,
  ): Promise<OAuth2Credential> {
    if (!current.refreshToken) throw new ConnectorAuthError("integration.oauth_no_refresh_token");
    return this.token(
      provider,
      client,
      { grant_type: "refresh_token", refresh_token: current.refreshToken },
      current,
      timeoutMs,
    );
  }

  private async token(
    provider: OAuthProviderConfig,
    client: OAuthClientCredentials,
    form: Record<string, string>,
    previous: OAuth2Credential | undefined,
    timeoutMs: number,
  ): Promise<OAuth2Credential> {
    const headers: Record<string, string> = {};
    const body = { ...form };
    if (provider.clientAuth === "basic") {
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString("base64")}`;
    } else {
      body.client_id = client.clientId;
      body.client_secret = client.clientSecret;
    }

    let response;
    try {
      response = await this.transport.postForm(provider.tokenUrl, body, { timeoutMs, headers });
    } catch (error) {
      if (error instanceof TransportError) throw new RetryableConnectorError();
      throw error;
    }

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      // invalid_grant / invalid_client: precisa reconectar; repetir não ajuda.
      throw new ConnectorAuthError("integration.oauth_grant_rejected");
    }
    if (response.status === 429 || response.status >= 500) throw new RetryableConnectorError();
    const data = response.body as Record<string, unknown> | undefined;
    if (response.status !== 200 || !data || typeof data.access_token !== "string" || !data.access_token) {
      throw new ConnectorConfigError("integration.oauth_response_invalid");
    }
    const seconds =
      typeof data.expires_in === "number" && Number.isFinite(data.expires_in) && data.expires_in > 0
        ? Math.min(data.expires_in, MAX_LIFETIME_SECONDS)
        : DEFAULT_LIFETIME_SECONDS;
    const refreshToken =
      typeof data.refresh_token === "string" && data.refresh_token
        ? data.refresh_token
        : previous?.refreshToken; // RFC 6749 §6: sem novo refresh token, vale o anterior
    return {
      kind: "oauth2",
      accessToken: data.access_token,
      refreshToken,
      expiresAt: new Date(this.now() + seconds * 1000),
    };
  }
}
