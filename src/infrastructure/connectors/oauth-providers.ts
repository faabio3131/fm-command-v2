import {
  OAuthProviderNotConfiguredError,
  type OAuthProviderConfig,
} from "@/domain/integration/oauth";
import type { OAuthClientCredentials } from "@/application/integration/oauth-client";

/**
 * Descritores dos provedores OAuth. Os endereços abaixo vêm de documentação de
 * terceiros e NÃO foram conferidos com um aplicativo real (ver ADR-022); por
 * isso podem ser trocados por variável de ambiente sem mudar o código.
 * Ids = `sourceType` da fonte.
 */
const DEFAULTS: Readonly<Record<string, OAuthProviderConfig>> = {
  conta_azul: {
    id: "conta_azul",
    authorizeUrl: "https://auth.contaazul.com/login",
    tokenUrl: "https://auth.contaazul.com/oauth2/token",
    clientAuth: "basic",
    usesPkce: true,
    scopes: ["openid", "profile", "aws.cognito.signin.user.admin"],
  },
  bling: {
    id: "bling",
    authorizeUrl: "https://www.bling.com.br/Api/v3/oauth/authorize",
    tokenUrl: "https://www.bling.com.br/Api/v3/oauth/token",
    clientAuth: "basic",
    usesPkce: false,
    scopes: [],
  },
};

type Env = Record<string, string | undefined>;
const envKey = (id: string, suffix: string) => `FMCC_OAUTH_${id.toUpperCase()}_${suffix}`;

function httpsUrl(value: string | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new OAuthProviderNotConfiguredError();
  return url.toString();
}

export function oauthProvider(id: string, env: Env = process.env): OAuthProviderConfig {
  const base = Object.prototype.hasOwnProperty.call(DEFAULTS, id) ? DEFAULTS[id] : undefined;
  if (!base) throw new OAuthProviderNotConfiguredError();
  try {
    return {
      ...base,
      authorizeUrl: httpsUrl(env[envKey(id, "AUTHORIZE_URL")], base.authorizeUrl),
      tokenUrl: httpsUrl(env[envKey(id, "TOKEN_URL")], base.tokenUrl),
    };
  } catch {
    throw new OAuthProviderNotConfiguredError();
  }
}

/** O aplicativo OAuth é do V2 (um por provedor), não de cada empresa. */
export function oauthClientCredentials(id: string, env: Env = process.env): OAuthClientCredentials {
  const clientId = env[envKey(id, "CLIENT_ID")]?.trim();
  const clientSecret = env[envKey(id, "CLIENT_SECRET")]?.trim();
  if (!clientId || !clientSecret) throw new OAuthProviderNotConfiguredError();
  return { clientId, clientSecret };
}
