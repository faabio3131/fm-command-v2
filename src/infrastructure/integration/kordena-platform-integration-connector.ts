import type {
  ConnectorContext,
  SourceDefinition,
} from "@/domain/integration/contracts";
import {
  CrossTenantAccessError,
} from "@/domain/security/tenant-context";
import {
  KORDENA_COMMERCIAL_SECRET_REF,
  KORDENA_COMMERCIAL_SOURCE_TYPE,
  KordenaCommercialConnectorError,
  type AllowedOriginResolver,
  type ControlTenantResolver,
  type SecretResolver,
  environmentKordenaAllowedOrigins,
  environmentKordenaControlTenantId,
  environmentSecretResolver,
} from "@/infrastructure/integration/kordena-commercial-connector";

export type PlatformParameterValue = string | number | boolean;

export interface KordenaPlatformIntegrationCatalog {
  readonly servico: string;
  readonly provedor: string;
  readonly label: string;
  readonly parametros_obrigatorios: readonly string[];
  readonly credenciais_obrigatorias: readonly string[];
  readonly healthcheck_supported: boolean;
  readonly escopo_gestao: "platform_managed";
}

export interface KordenaPlatformIntegrationReadiness {
  readonly estado: string;
  readonly pronto: boolean;
  readonly faltam_parametros: readonly string[];
  readonly faltam_finalidades: readonly string[];
  readonly faltam_credenciais: readonly string[];
}

export interface KordenaPlatformIntegrationConfiguration {
  readonly configuracao_id: string;
  readonly servico: string;
  readonly provedor: string;
  readonly conta_externa: string;
  readonly ambiente: string;
  readonly parametros: Readonly<Record<string, PlatformParameterValue>>;
  readonly credenciais_estado: Readonly<Record<string, boolean>>;
  readonly habilitada: boolean;
  readonly homologada: boolean;
  readonly evidencia_homologacao_ref: string | null;
  readonly versao: number;
  readonly prontidao: KordenaPlatformIntegrationReadiness;
}

export interface KordenaPlatformIntegration {
  readonly catalogo: KordenaPlatformIntegrationCatalog;
  readonly configuracao: KordenaPlatformIntegrationConfiguration | null;
}

export interface KordenaPlatformIntegrationsOverview {
  readonly integracoes: readonly KordenaPlatformIntegration[];
}

export interface KordenaPlatformActor {
  readonly user_id: string;
  readonly role: "owner" | "admin";
  readonly step_up_at: string;
}

export interface KordenaPlatformIntegrationConfigInput {
  readonly servico: string;
  readonly provedor: string;
  readonly conta_externa: string;
  readonly ambiente: string;
  readonly parametros: readonly {
    readonly nome: string;
    readonly valor: PlatformParameterValue;
  }[];
  readonly credenciais: readonly {
    readonly papel: string;
    readonly valor: string;
  }[];
  readonly habilitada: boolean;
  readonly versao: number;
}

export interface KordenaPlatformHealthcheck {
  readonly executado: boolean;
  readonly suportado: boolean;
  readonly provedor: string;
  readonly evidencia_ref?: string | null;
  readonly detalhes?: Readonly<Record<string, unknown>> | null;
  readonly erro?: string | null;
}

function sourceBaseUrl(
  source: SourceDefinition,
  allowedOrigins: readonly string[],
): string {
  if (source.sourceType !== KORDENA_COMMERCIAL_SOURCE_TYPE) {
    throw new KordenaCommercialConnectorError(
      "integration.kordena_commercial_source_invalid",
    );
  }
  const raw = source.config.baseUrl;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new KordenaCommercialConnectorError(
      "integration.kordena_base_url_missing",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new KordenaCommercialConnectorError(
      "integration.kordena_base_url_invalid",
    );
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new KordenaCommercialConnectorError(
      "integration.kordena_base_url_insecure",
    );
  }
  const allowed = new Set(
    allowedOrigins.map((value) => new URL(value).origin),
  );
  if (!allowed.has(parsed.origin)) {
    throw new KordenaCommercialConnectorError(
      "integration.kordena_origin_not_allowed",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

function serviceToken(
  source: SourceDefinition,
  resolveSecret: SecretResolver,
): string {
  if (source.secretRef !== KORDENA_COMMERCIAL_SECRET_REF) {
    throw new KordenaCommercialConnectorError(
      "integration.kordena_secret_reference_invalid",
    );
  }
  const token = resolveSecret(source.secretRef)?.trim();
  if (!token || token.length < 32) {
    throw new KordenaCommercialConnectorError(
      "integration.kordena_service_token_unavailable",
    );
  }
  return token;
}

function safeUpstreamError(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).error === "string"
  ) {
    const code = String((value as Record<string, unknown>).error);
    if (/^[a-z0-9._:-]{1,160}$/i.test(code)) return code;
  }
  return "integration.kordena_platform_integration_rejected";
}

export class KordenaPlatformIntegrationConnector {
  constructor(
    private readonly resolveSecret: SecretResolver = environmentSecretResolver,
    private readonly fetcher: typeof fetch = fetch,
    private readonly allowedOrigins: AllowedOriginResolver =
      environmentKordenaAllowedOrigins,
    private readonly controlTenantId: ControlTenantResolver =
      environmentKordenaControlTenantId,
  ) {}

  async overview(
    context: ConnectorContext,
    source: SourceDefinition,
  ): Promise<KordenaPlatformIntegrationsOverview> {
    return this.requestJson<KordenaPlatformIntegrationsOverview>(
      context,
      source,
      "/v1/control-plane/fmcc/integrations",
    );
  }

  async configure(
    context: ConnectorContext,
    source: SourceDefinition,
    input: {
      configId: string;
      actor: KordenaPlatformActor;
      configuracao: KordenaPlatformIntegrationConfigInput;
    },
  ): Promise<KordenaPlatformIntegrationConfiguration> {
    return this.requestJson<KordenaPlatformIntegrationConfiguration>(
      context,
      source,
      `/v1/control-plane/fmcc/integrations/${encodeURIComponent(input.configId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: input.actor,
          configuracao: input.configuracao,
        }),
      },
    );
  }

  async healthcheck(
    context: ConnectorContext,
    source: SourceDefinition,
    input: {
      configId: string;
      actor: KordenaPlatformActor;
    },
  ): Promise<KordenaPlatformHealthcheck> {
    return this.requestJson<KordenaPlatformHealthcheck>(
      context,
      source,
      `/v1/control-plane/fmcc/integrations/${encodeURIComponent(input.configId)}/healthcheck`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: input.actor }),
      },
    );
  }

  async homologate(
    context: ConnectorContext,
    source: SourceDefinition,
    input: {
      configId: string;
      actor: KordenaPlatformActor;
      evidenceRef: string;
    },
  ): Promise<KordenaPlatformIntegrationConfiguration> {
    return this.requestJson<KordenaPlatformIntegrationConfiguration>(
      context,
      source,
      `/v1/control-plane/fmcc/integrations/${encodeURIComponent(input.configId)}/homologar`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: input.actor,
          evidencia_ref: input.evidenceRef,
        }),
      },
    );
  }

  private async requestJson<T>(
    context: ConnectorContext,
    source: SourceDefinition,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const allowedTenant = this.controlTenantId();
    if (!allowedTenant || context.tenantId !== allowedTenant) {
      throw new CrossTenantAccessError();
    }
    if (
      !Number.isFinite(context.timeoutMs) ||
      context.timeoutMs < 1 ||
      context.timeoutMs > 120_000
    ) {
      throw new KordenaCommercialConnectorError(
        "integration.kordena_timeout_invalid",
      );
    }

    const token = serviceToken(source, this.resolveSecret);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-correlation-id", context.correlationId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), context.timeoutMs);
    try {
      const response = await this.fetcher(
        `${sourceBaseUrl(source, this.allowedOrigins())}${path}`,
        { ...init, headers, signal: controller.signal },
      );
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new KordenaCommercialConnectorError(safeUpstreamError(body));
      }
      if (!body || typeof body !== "object") {
        throw new KordenaCommercialConnectorError(
          "integration.kordena_platform_integration_contract_invalid",
        );
      }
      return body as T;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new KordenaCommercialConnectorError(
          "integration.kordena_request_timeout",
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
