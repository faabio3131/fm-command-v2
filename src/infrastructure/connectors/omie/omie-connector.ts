import {
  ConnectorAuthError,
  ConnectorConfigError,
  ConnectorRateLimitedError,
  RetryableConnectorError,
  type Connector,
  type ConnectorContext,
  type ConnectorFact,
  type ConnectorPullResult,
  type SourceDefinition,
} from "@/domain/integration/contracts";
import type { CredentialStore } from "@/domain/integration/credentials";
import { systemClock, type Clock, type RateLimiter } from "@/application/integration/rate-limiter";
import { effectiveOmieLimits, OMIE_PAGE_SIZE, type OmieClient } from "./omie-client";
import { mapOmieRecord, OMIE_STREAMS, type OmieStream } from "./omie-mapping";

export const OMIE_SOURCE_TYPE = "omie";
const STREAM_ORDER: readonly OmieStream[] = ["receivable", "payable"];
const MAX_PAGE = 100_000;

interface Cursor {
  s: OmieStream;
  p: number;
  /** Só traz registros alterados a partir deste dia (YYYY-MM-DD). Ausente = leitura completa. */
  since?: string;
  /** Dia em que este ciclo começou; vira `since` do ciclo seguinte. */
  w?: string;
}

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function parseCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ConnectorConfigError("integration.connector_cursor_invalid");
  }
  const c = value as Partial<Cursor> | null;
  if (
    !c || typeof c !== "object" ||
    !STREAM_ORDER.includes(c.s as OmieStream) ||
    !Number.isInteger(c.p) || (c.p as number) < 1 || (c.p as number) > MAX_PAGE ||
    (c.since !== undefined && !validDay(c.since)) ||
    (c.w !== undefined && !validDay(c.w))
  ) {
    throw new ConnectorConfigError("integration.connector_cursor_invalid");
  }
  return { s: c.s as OmieStream, p: c.p as number, since: c.since, w: c.w };
}

function dayInOmieZone(now: Date, utcOffsetMinutes: number): string {
  return new Date(now.getTime() + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function ddmmyyyy(isoDay: string): string {
  const [y, m, d] = isoDay.split("-");
  return `${d}/${m}/${y}`;
}

function previousDay(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function readConfig(config: Readonly<Record<string, unknown>>) {
  const currency = typeof config.currency === "string" ? config.currency : "BRL";
  if (!/^[A-Z]{3}$/.test(currency)) throw new ConnectorConfigError("integration.connector_currency_invalid");
  const offset = typeof config.utcOffsetMinutes === "number" ? config.utcOffsetMinutes : -180;
  if (!Number.isInteger(offset) || offset < -720 || offset > 840) {
    throw new ConnectorConfigError("integration.connector_timezone_invalid");
  }
  const unitRefField = typeof config.unitRefField === "string" && /^[a-z_][a-z0-9_]*$/i.test(config.unitRefField)
    ? config.unitRefField
    : undefined;
  return { currency, utcOffsetMinutes: offset, unitRefField, limits: effectiveOmieLimits(config) };
}

export class OmieConnector implements Connector {
  readonly sourceType = OMIE_SOURCE_TYPE;
  readonly capabilities = ["finance.receivable.read", "finance.payable.read"] as const;

  constructor(
    private readonly client: OmieClient,
    private readonly credentials: CredentialStore,
    private readonly clock: Clock = systemClock,
    // O limitador é do cliente HTTP; aqui só a dependência fica explícita para a composição.
    readonly limiter?: RateLimiter,
  ) {}

  private async credentialFor(context: ConnectorContext, source: SourceDefinition) {
    // Defesa em profundidade: o runtime já filtra por empresa, o conector confere de novo.
    if (source.tenantId !== context.tenantId) throw new ConnectorConfigError("integration.connector_tenant_mismatch");
    if (!source.secretRef) throw new ConnectorConfigError("integration.connector_credential_missing");
    return this.credentials.resolve(context.tenantId, source.secretRef);
  }

  async health(context: ConnectorContext, source: SourceDefinition) {
    const cfg = readConfig(source.config);
    const credential = await this.credentialFor(context, source);
    try {
      await this.client.call({
        tenantId: context.tenantId,
        credential,
        path: OMIE_STREAMS.receivable.path,
        method: OMIE_STREAMS.receivable.method,
        param: { pagina: 1, registros_por_pagina: 1, apenas_importado_api: "N" },
        limits: cfg.limits,
        timeoutMs: context.timeoutMs,
      });
      return "healthy" as const;
    } catch (error) {
      if (error instanceof ConnectorAuthError) return "unavailable" as const;
      if (error instanceof ConnectorRateLimitedError || error instanceof RetryableConnectorError) return "degraded" as const;
      throw error;
    }
  }

  async pull(context: ConnectorContext, source: SourceDefinition, rawCursor?: string): Promise<ConnectorPullResult> {
    const cfg = readConfig(source.config);
    const cursor = parseCursor(rawCursor) ?? { s: STREAM_ORDER[0], p: 1 };
    const now = new Date(this.clock.now());
    const cycleDay = cursor.w ?? dayInOmieZone(now, cfg.utcOffsetMinutes);
    const credential = await this.credentialFor(context, source);
    const stream = OMIE_STREAMS[cursor.s];

    const param: Record<string, unknown> = {
      pagina: cursor.p,
      registros_por_pagina: OMIE_PAGE_SIZE,
      apenas_importado_api: "N",
    };
    if (cursor.since) {
      // Um dia de folga cobre a diferença de fuso; repetir registros é inofensivo (deduplicação).
      param.filtrar_apenas_alteracao = "S";
      param.filtrar_por_data_de = ddmmyyyy(previousDay(cursor.since));
    }

    const result = await this.client.call({
      tenantId: context.tenantId,
      credential,
      path: stream.path,
      method: stream.method,
      param,
      limits: cfg.limits,
      timeoutMs: context.timeoutMs,
    });

    const facts: ConnectorFact[] = [];
    let skipped = 0;
    let totalPages = cursor.p; // sem contagem de páginas, trata como a última
    if (result.kind === "ok") {
      const list = result.body[stream.listKey];
      // Resposta "ok" sem a lista esperada é mudança de contrato do Omie, não "sem registros".
      if (!Array.isArray(list)) throw new ConnectorConfigError("integration.connector_response_invalid");
      const records = list;
      for (const record of records) {
        const fact = mapOmieRecord(cursor.s, record, {
          currency: cfg.currency,
          utcOffsetMinutes: cfg.utcOffsetMinutes,
          unitRefField: cfg.unitRefField,
          retrievedAt: now,
        });
        if (fact) facts.push(fact);
        else skipped += 1;
      }
      const pages = result.body.total_de_paginas;
      if (typeof pages === "number" && Number.isInteger(pages) && pages >= 1) totalPages = pages;
    }

    let next: Cursor;
    if (cursor.p < totalPages && cursor.p < MAX_PAGE) {
      next = { s: cursor.s, p: cursor.p + 1, since: cursor.since, w: cycleDay };
    } else {
      const index = STREAM_ORDER.indexOf(cursor.s);
      next = index + 1 < STREAM_ORDER.length
        ? { s: STREAM_ORDER[index + 1], p: 1, since: cursor.since, w: cycleDay }
        : { s: STREAM_ORDER[0], p: 1, since: cycleDay }; // ciclo completo: o próximo é incremental
    }
    return { facts, nextCursor: JSON.stringify(next), skipped };
  }
}
