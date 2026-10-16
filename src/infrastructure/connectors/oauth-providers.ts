import {
  OAuthProviderNotConfiguredError,
  type OAuthProviderConfig,
} from "@/domain/integration/oauth";
import type { OAuthClientCredentials } from "@/application/integration/oauth-client";

/**
 * Descritores dos provedores OAuth. Os endereços marcados como conferidos vêm da documentação oficial; os demais vêm de
 * terceiros e NÃO foram conferidos (ver ADR-022). Todos podem ser trocados por variável de ambiente sem mudar o código.
 * Ids = `sourceType` da fonte.
 */
const DEFAULTS: Readonly<Record<string, OAuthProviderConfig>> = {
  // Conferido na documentação oficial (developers.contaazul.com, 16/10/2026): o login usa
  // fragmento (`#/oauth/authorize`), o token sai do api-v2 com Basic, e PKCE não é citado.
  conta_azul: {
    id: "conta_azul",
    authorizeUrl: "https://login.contaazul.com/#/oauth/authorize",
    tokenUrl: "https://api-v2.contaazul.com/oauth/token",
    clientAuth: "basic",
    usesPkce: false,
    queryInFragment: true,
    scopes: ["openid", "profile", "aws.cognito.signin.user.admin"],
  },
  // Conferido na documentação oficial (developer.bling.com.br, 16/10/2026): login em www.bling.com.br,
  // token em api.bling.com.br com Basic; redirect e escopos vêm do cadastro do aplicativo.
  // (A especificação OpenAPI cita bling.com.br para o token; o guia usa api.bling.com.br — o guia manda.)
  bling: {
    id: "bling",
    authorizeUrl: "https://www.bling.com.br/Api/v3/oauth/authorize",
    tokenUrl: "https://api.bling.com.br/Api/v3/oauth/token",
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
