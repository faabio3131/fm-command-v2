import {
  ConnectorAuthError,
  ConnectorConfigError,
  ConnectorRateLimitedError,
  RetryableConnectorError,
} from "@/domain/integration/contracts";
import type { ConnectorCredential } from "@/domain/integration/credentials";
import { RateLimitWaitExceededError, type RateLimiter, type RateLimits } from "@/application/integration/rate-limiter";
import type { JsonHttpTransport } from "@/infrastructure/connectors/http-json-transport";
import { TransportError } from "@/infrastructure/connectors/http-json-transport";

/**
 * Cliente da API do Omie (JSON sobre POST; não há REST). Os limites abaixo
 * vêm da documentação pública do Omie e são o teto: a configuração da fonte
 * só pode baixá-los. O endereço é fixo de propósito: uma fonte configurada
 * por cliente não pode apontar o servidor para outro destino.
 */
export const OMIE_BASE_URL = "https://app.omie.com.br/api/v1/";
export const OMIE_MAX_LIMITS: RateLimits = { requestsPerMinute: 240, maxConcurrent: 4 };
export const OMIE_PAGE_SIZE = 100;

export function effectiveOmieLimits(config: Readonly<Record<string, unknown>>): RateLimits {
  const raw = config.limits;
  const configured = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pick = (value: unknown, max: number) =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 ? Math.min(value, max) : max;
  return {
    requestsPerMinute: pick(configured.requestsPerMinute, OMIE_MAX_LIMITS.requestsPerMinute),
    maxConcurrent: pick(configured.maxConcurrent, OMIE_MAX_LIMITS.maxConcurrent),
  };
}

const NO_RECORDS = /n[aã]o existem registros/i;
const AUTH_FAULT = /(app[ _-]?key|app[ _-]?secret|chave de acesso|credencia|n[aã]o autorizado|acesso negado)/i;
const BLOCK_FAULT = /(bloquead|consumo redundante|muitas requisi)/i;

export type OmieResult =
  | { readonly kind: "ok"; readonly body: Record<string, unknown> }
  | { readonly kind: "empty" };

export class OmieClient {
  constructor(
    private readonly transport: JsonHttpTransport,
    private readonly limiter: RateLimiter,
  ) {}

  async call(input: {
    tenantId: string;
    credential: ConnectorCredential;
    path: string; // ex.: "financeiro/contareceber"
    method: string; // ex.: "ListarContasReceber"
    param: Record<string, unknown>;
    limits: RateLimits;
    timeoutMs: number;
  }): Promise<OmieResult> {
    if (input.credential.kind !== "api_key_pair") {
      throw new ConnectorConfigError("integration.connector_credential_kind_invalid");
    }
    const { appKey, appSecret } = input.credential;
    const url = `${OMIE_BASE_URL}${input.path}/`;
    // O limite do Omie é por chave e por método; a chave de limite inclui a empresa.
    const limiterKey = `${input.tenantId}:omie:${input.path}:${input.method}`;

    let response;
    try {
      response = await this.limiter.run(limiterKey, input.limits, () =>
        this.transport.post(
          url,
          { call: input.method, app_key: appKey, app_secret: appSecret, param: [input.param] },
          { timeoutMs: Math.floor(input.timeoutMs / 2) },
        ),
        // A espera por vaga não pode passar do prazo do runtime: depois dele o runtime já desistiu.
        { maxWaitMs: Math.floor(input.timeoutMs / 2) },
      );
    } catch (error) {
      if (error instanceof RateLimitWaitExceededError) throw new ConnectorRateLimitedError();
      if (error instanceof TransportError) throw new RetryableConnectorError();
      throw error;
    }

    const body =
      response.body && typeof response.body === "object" && !Array.isArray(response.body)
        ? (response.body as Record<string, unknown>)
        : undefined;
    const fault = typeof body?.faultstring === "string" ? body.faultstring : undefined;

    if (response.status === 425 || response.status === 429 || (fault && BLOCK_FAULT.test(fault))) {
      throw new ConnectorRateLimitedError();
    }
    if (response.status === 401 || response.status === 403 || (fault && AUTH_FAULT.test(fault))) {
      throw new ConnectorAuthError();
    }
    if (fault && NO_RECORDS.test(fault)) return { kind: "empty" };
    if (fault) {
      // O Omie responde erro funcional com HTTP 500 e `faultstring`: repetir não resolve.
      throw new ConnectorConfigError("integration.connector_request_rejected");
    }
    if (response.status >= 500 || response.status === 408) throw new RetryableConnectorError();
    if (response.status !== 200 || !body) {
      throw new ConnectorConfigError("integration.connector_response_invalid");
    }
    return { kind: "ok", body };
  }
}
