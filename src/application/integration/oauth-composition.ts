import { serverEnv } from "@/config/env";
import { FetchJsonTransport } from "@/infrastructure/connectors/http-json-transport";
import { oauthClientCredentials, oauthProvider } from "@/infrastructure/connectors/oauth-providers";
import { PostgresCredentialStore } from "@/infrastructure/integration/postgres-credential-store";
import { PostgresOAuthStateStore } from "@/infrastructure/integration/postgres-oauth-state-store";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { OAuthClient } from "./oauth-client";
import { OAuthConnectionService } from "./oauth-connection-service";
import { OAuthTokenService } from "./oauth-token-service";

export const oauthRedirectUri = () => new URL("/api/oauth/callback", serverEnv().authUrl).toString();

export function buildOAuthConnectionService() {
  return new OAuthConnectionService({
    sources: new PostgresSourceRepository(),
    states: new PostgresOAuthStateStore(),
    credentials: new PostgresCredentialStore(),
    client: new OAuthClient(new FetchJsonTransport()),
    provider: (id) => oauthProvider(id),
    clientCredentials: (id) => oauthClientCredentials(id),
    redirectUri: oauthRedirectUri(),
  });
}

export function buildOAuthTokenService() {
  return new OAuthTokenService(new PostgresCredentialStore(), new OAuthClient(new FetchJsonTransport()));
}
