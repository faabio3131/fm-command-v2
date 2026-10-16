import { systemClock, type Clock, type RateLimiter, RateLimitWaitExceededError } from "@/application/integration/rate-limiter";
import type { OAuthClientCredentials } from "@/application/integration/oauth-client";
import type { OAuthTokenService } from "@/application/integration/oauth-token-service";
import {
  ConnectorAuthError,
  ConnectorConfigError,
  ConnectorRateLimitedError,
  RetryableConnectorError,
  type Connector,
  type ConnectorContext,
  type ConnectorPullResult,
  type SourceDefinition,
} from "@/domain/integration/contracts";
import {
  VARIABLE_VALUE,
  type ConnectorDefinition,
  type StreamDefinition,
} from "@/domain/integration/connector-definition";
import type { CredentialStore } from "@/domain/integration/credentials";
import type { OAuthProviderConfig } from "@/domain/integration/oauth";
import { TransportError, type JsonHttpTransport } from "@/infrastructure/connectors/http-json-transport";
import { getPath } from "./json-path";
import { mapDeclarativeRecord } from "./declarative-mapping";

export interface DeclarativeDeps {
  readonly transport: JsonHttpTransport;
  readonly limiter: RateLimiter;
  readonly credentials: CredentialStore;
  readonly tokens?: Pick<OAuthTokenService, "accessToken">;
  readonly oauthProvider?: (id: string) => OAuthProviderConfig;
  readonly oauthClient?: (id: string) => OAuthClientCredentials;
  readonly clock?: Clock;
}

const MAX_PAGE = 100_000;

interface Cursor {
  s: string;
  p: number;
  since?: string;
  w?: string;
  /** impressão da primeira linha da página anterior (detecta API que ignora a página) */
  h?: string;
  /** registros já lidos neste fluxo (paginação por total de registros) */
  n?: number;
}

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function previousDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Configuração da fonte já filtrada: só o que a definição permite. */
function sourceSettings(def: ConnectorDefinition, config: Readonly<Record<string, unknown>>) {
  const currency = typeof config.currency === "string" ? config.currency : "BRL";
  if (!/^[A-Z]{3}$/.test(currency)) throw new ConnectorConfigError("integration.connector_currency_invalid");
  const raw = config.variables;
  const given = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const variables: Record<string, string> = {};
  for (const name of def.variables ?? []) {
    const v = given[name];
    if (typeof v !== "string" || !VARIABLE_VALUE.test(v)) throw new ConnectorConfigError("integration.connector_variable_invalid");
    variables[name] = v;
  }
  const lim = config.limits && typeof config.limits === "object" && !Array.isArray(config.limits) ? (config.limits as Record<string, unknown>) : {};
  const pick = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? Math.min(v, max) : max);
  return {
    currency,
    variables,
    limits: {
      requestsPerMinute: pick(lim.requestsPerMinute, def.limits.requestsPerMinute),
      maxConcurrent: pick(lim.maxConcurrent, def.limits.maxConcurrent),
    },
  };
}

function fill(template: string, variables: Readonly<Record<string, string>>, encode: boolean): string {
  return template.replace(/\{([^}]*)\}/g, (_m, name: string) => (encode ? encodeURIComponent(variables[name]) : variables[name]));
}

export class DeclarativeRestConnector implements Connector {
  readonly sourceType: string;
  readonly capabilities: readonly string[];
  private readonly clock: Clock;

  constructor(private readonly def: ConnectorDefinition, private readonly deps: DeclarativeDeps) {
    this.sourceType = def.id;
    this.capabilities = def.streams.map((s) => `${s.factType}.read`);
    this.clock = deps.clock ?? systemClock;
  }

  private async headers(context: ConnectorContext, source: SourceDefinition): Promise<Record<string, string>> {
    // Defesa em profundidade: o runtime já filtra por empresa, o conector confere de novo.
    if (source.tenantId !== context.tenantId) throw new ConnectorConfigError("integration.connector_tenant_mismatch");
    if (!source.secretRef) throw new ConnectorConfigError("integration.connector_credential_missing");
    const auth = this.def.auth;
    if (auth.type === "oauth2") {
      if (!this.deps.tokens || !this.deps.oauthProvider || !this.deps.oauthClient) {
        throw new ConnectorConfigError("integration.connector_oauth_not_available");
      }
      const token = await this.deps.tokens.accessToken(
        context.tenantId, source.secretRef, this.deps.oauthProvider(auth.providerId), this.deps.oauthClient(auth.providerId), context.timeoutMs,
      );
      return { authorization: `Bearer ${token}` };
    }
    const credential = await this.deps.credentials.resolve(context.tenantId, source.secretRef);
    if (credential.kind !== "api_key") throw new ConnectorConfigError("integration.connector_credential_kind_invalid");
    return { [auth.header]: credential.apiKey };
  }

  private buildUrl(path: string, query: Record<string, string>, variables: Readonly<Record<string, string>>): string {
    const url = new URL(this.def.baseUrl + fill(path, variables, true));
    if (url.origin !== new URL(this.def.baseUrl).origin) throw new ConnectorConfigError("integration.connector_url_invalid");
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url.toString();
  }

  private async get(
    context: ConnectorContext,
    source: SourceDefinition,
    url: string,
    limits: { requestsPerMinute: number; maxConcurrent: number },
  ) {
    const headers = await this.headers(context, source);
    const key = `${context.tenantId}:${this.def.id}:${source.secretRef ?? source.id}`;
    let response;
    try {
      response = await this.deps.limiter.run(
        key, limits,
        () => this.deps.transport.get(url, { timeoutMs: Math.floor(context.timeoutMs / 2), headers }),
        { maxWaitMs: Math.floor(context.timeoutMs / 2) },
      );
    } catch (error) {
      if (error instanceof RateLimitWaitExceededError) throw new ConnectorRateLimitedError();
      if (error instanceof TransportError) throw new RetryableConnectorError();
      throw error;
    }
    if (response.status === 401 || response.status === 403) throw new ConnectorAuthError();
    if (response.status === 429) throw new ConnectorRateLimitedError();
    if (response.status === 408 || response.status >= 500) throw new RetryableConnectorError();
    if (response.status !== 200) throw new ConnectorConfigError("integration.connector_request_rejected");
    return response.body;
  }

  async health(context: ConnectorContext, source: SourceDefinition) {
    const settings = sourceSettings(this.def, source.config);
    const path = this.def.health?.path ?? this.def.streams[0]?.path;
    if (!path) throw new ConnectorConfigError("integration.connector_not_ready");
    try {
      await this.get(context, source, this.buildUrl(path, {}, settings.variables), settings.limits);
      return "healthy" as const;
    } catch (error) {
      if (error instanceof ConnectorAuthError) return "unavailable" as const;
      if (error instanceof ConnectorRateLimitedError || error instanceof RetryableConnectorError) return "degraded" as const;
      throw error;
    }
  }

  private parseCursor(raw: string | undefined): Cursor {
    const first = this.def.streams[0];
    if (!raw) return { s: first.name, p: first.pagination.style === "page" ? first.pagination.startPage ?? 1 : 1 };
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new ConnectorConfigError("integration.connector_cursor_invalid"); }
    const c = value as Partial<Cursor> | null;
    if (
      !c || typeof c !== "object" || typeof c.s !== "string" ||
      !this.def.streams.some((s) => s.name === c.s) ||
      !Number.isInteger(c.p) || (c.p as number) < 0 || (c.p as number) > MAX_PAGE ||
      (c.since !== undefined && !validDay(c.since)) || (c.w !== undefined && !validDay(c.w))
    ) throw new ConnectorConfigError("integration.connector_cursor_invalid");
    return { s: c.s, p: c.p as number, since: c.since, w: c.w, h: typeof c.h === "string" && c.h.length <= 128 ? c.h : undefined, n: Number.isSafeInteger(c.n) && (c.n as number) >= 0 && (c.n as number) <= 100_000_000 ? c.n : undefined };
  }

  async pull(context: ConnectorContext, source: SourceDefinition, rawCursor?: string): Promise<ConnectorPullResult> {
    if (this.def.status !== "ready") throw new ConnectorConfigError("integration.connector_not_ready");
    const settings = sourceSettings(this.def, source.config);
    const cursor = this.parseCursor(rawCursor);
    const index = this.def.streams.findIndex((s) => s.name === cursor.s);
    const stream: StreamDefinition = this.def.streams[index];
    if (stream.pagination.style === "offset" && cursor.p < 1) throw new ConnectorConfigError("integration.connector_cursor_invalid");
    const now = new Date(this.clock.now());
    const cycleDay = cursor.w ?? now.toISOString().slice(0, 10);

    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(stream.query ?? {})) query[k] = fill(v, settings.variables, false);
    const pg = stream.pagination;
    if (pg.style === "page") {
      query[pg.pageParam] = String(cursor.p);
      if (pg.sizeParam) query[pg.sizeParam] = String(pg.size);
    } else {
      query[pg.offsetParam] = String((cursor.p - 1) * pg.size);
      query[pg.sizeParam] = String(pg.size);
    }
    if (stream.window) {
      query[stream.window.fromParam] = addDays(cycleDay, -stream.window.pastDays);
      query[stream.window.toParam] = addDays(cycleDay, stream.window.futureDays);
    }
    if (cursor.since && stream.incremental) {
      const day = previousDay(cursor.since); // um dia de folga cobre fuso; repetir registro é inofensivo
      query[stream.incremental.param] = stream.incremental.format === "iso_date" ? day : `${day}T00:00:00Z`;
    }

    const body = await this.get(context, source, this.buildUrl(stream.path, query, settings.variables), settings.limits);
    const list = getPath(body, stream.recordsPath);
    // Resposta ok sem a lista esperada é mudança de contrato, não "sem registros".
    if (!Array.isArray(list)) throw new ConnectorConfigError("integration.connector_response_invalid");

    const facts = [];
    let skipped = 0;
    for (const record of list) {
      const fact = mapDeclarativeRecord(stream, record, { currency: settings.currency, retrievedAt: now });
      if (fact) facts.push(fact); else skipped += 1;
    }

    const totalRaw = pg.totalPagesPath ? getPath(body, pg.totalPagesPath) : undefined;
    const firstPage = pg.style === "page" ? pg.startPage ?? 1 : 1;
    const fingerprint = list.length ? JSON.stringify(list[0]).slice(0, 128) : undefined;
    const repeated = fingerprint !== undefined && fingerprint === cursor.h;
    const countRaw = pg.style === "page" && pg.totalCountPath ? getPath(body, pg.totalCountPath) : undefined;
    const hasMore = !repeated && (typeof totalRaw === "number" && Number.isInteger(totalRaw) && totalRaw >= 1
      ? cursor.p < totalRaw - 1 + firstPage
      : typeof countRaw === "number" && Number.isInteger(countRaw) && countRaw >= 0
        // Total de registros: conta o que já foi lido (a API pode limitar o tamanho pedido).
        ? list.length > 0 && (cursor.n ?? 0) + list.length < countRaw
        : list.length >= pg.size);

    let next: Cursor;
    if (hasMore && cursor.p < MAX_PAGE) {
      next = { s: stream.name, p: cursor.p + 1, since: cursor.since, w: cycleDay, h: fingerprint, n: (cursor.n ?? 0) + list.length };
    } else if (index + 1 < this.def.streams.length) {
      const nx = this.def.streams[index + 1];
      next = { s: nx.name, p: nx.pagination.style === "page" ? nx.pagination.startPage ?? 1 : 1, since: cursor.since, w: cycleDay };
    } else {
      const f = this.def.streams[0];
      next = { s: f.name, p: f.pagination.style === "page" ? f.pagination.startPage ?? 1 : 1, since: cycleDay };
    }
    return { facts, nextCursor: JSON.stringify(next), skipped };
  }
}
