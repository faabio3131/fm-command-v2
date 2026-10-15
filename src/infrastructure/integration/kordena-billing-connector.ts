import type {
  ConnectorContext,
  SourceDefinition,
} from "@/domain/integration/contracts";
import {
  KORDENA_COMMERCIAL_SECRET_REF,
  KordenaCommercialConnectorError,
  environmentKordenaAllowedOrigins,
  environmentKordenaControlTenantId,
  environmentSecretResolver,
  type AllowedOriginResolver,
  type ControlTenantResolver,
  type KordenaBillingCommand,
  type KordenaBillingConfigurationOptions,
  type KordenaBillingOverview,
  type KordenaBillingProviderAccount,
  type KordenaBillingRoutingPolicy,
  type SecretResolver,
} from "@/infrastructure/integration/kordena-commercial-connector";

function sourceBaseUrl(
  source: SourceDefinition,
  allowedOrigins: readonly string[],
): string {
  const raw = source.config.baseUrl;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new KordenaCommercialConnectorError(
      "integration.kordena_base_url_missing",
    );
  }
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new KordenaCommercialConnectorError(
      "integration.kordena_base_url_invalid",
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

export class KordenaBillingConnector {
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
  ): Promise<KordenaBillingOverview> {
    const optionsResponse = await this.request(
      context,
      source,
      "/v1/control-plane/fmcc/billing/configuration-options",
    );
    const accountsResponse = await this.request(
      context,
      source,
      "/v1/control-plane/fmcc/billing/provider-accounts",
    );
    const routingResponse = await this.request(
      context,
      source,
      "/v1/control-plane/fmcc/billing/routing-policies",
    );

    if (!optionsResponse.ok || !accountsResponse.ok || !routingResponse.ok) {
      throw new KordenaCommercialConnectorError(
        "integration.kordena_billing_unavailable",
      );
    }

    const options =
      (await optionsResponse.json()) as Partial<KordenaBillingConfigurationOptions>;
    const providerAccounts = (await accountsResponse.json()) as unknown;
    const routingPolicies = (await routingResponse.json()) as unknown;

    if (
      !Array.isArray(options.provider_codes) ||
      !Array.isArray(options.legal_entity_types) ||
      !Array.isArray(options.payment_methods) ||
      !Array.isArray(options.environments) ||
      !Array.isArray(providerAccounts) ||
      !Array.isArray(routingPolicies)
    ) {
      throw new KordenaCommercialConnectorError(
        "integration.kordena_billing_contract_invalid",
      );
    }

    return {
      options: options as KordenaBillingConfigurationOptions,
      providerAccounts: providerAccounts as KordenaBillingProviderAccount[],
      routingPolicies: routingPolicies as KordenaBillingRoutingPolicy[],
    };
  }

  async command(
    context: ConnectorContext,
    source: SourceDefinition,
    input: KordenaBillingCommand,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const resource = input.resource_id?.trim();
    const route = this.commandRoute(input.action, resource);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (idempotencyKey?.trim()) {
      headers["idempotency-key"] = idempotencyKey.trim();
    }

    const response = await this.request(context, source, route.path, {
      method: route.method,
      headers,
      body: JSON.stringify({
        actor: input.actor,
        ...input.payload,
      }),
    });

    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as
        | { error?: unknown }
        | null;
      throw new KordenaCommercialConnectorError(
        typeof failure?.error === "string"
          ? failure.error
          : "integration.kordena_billing_command_rejected",
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private commandRoute(
    action: KordenaBillingCommand["action"],
    resource?: string,
  ): { path: string; method: "POST" | "PUT" } {
    if (action === "provider.create") {
      return {
        path: "/v1/control-plane/fmcc/billing/provider-accounts",
        method: "POST",
      };
    }
    if (action === "routing.create") {
      return {
        path: "/v1/control-plane/fmcc/billing/routing-policies",
        method: "POST",
      };
    }
    if (!resource) {
      throw new KordenaCommercialConnectorError(
        "integration.kordena_billing_resource_required",
      );
    }
    const id = encodeURIComponent(resource);
    const routes = {
      "provider.update": {
        path: `/v1/control-plane/fmcc/billing/provider-accounts/${id}`,
        method: "PUT" as const,
      },
      "provider.credential": {
        path: `/v1/control-plane/fmcc/billing/provider-accounts/${id}/credential`,
        method: "POST" as const,
      },
      "provider.test": {
        path: `/v1/control-plane/fmcc/billing/provider-accounts/${id}/test-connection`,
        method: "POST" as const,
      },
      "provider.status": {
        path: `/v1/control-plane/fmcc/billing/provider-accounts/${id}/status`,
        method: "POST" as const,
      },
      "routing.update": {
        path: `/v1/control-plane/fmcc/billing/routing-policies/${id}`,
        method: "PUT" as const,
      },
    };
    return routes[action];
  }

  private async request(
    context: ConnectorContext,
    source: SourceDefinition,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const allowedTenant = this.controlTenantId();
    if (!allowedTenant || context.tenantId !== allowedTenant) {
      throw new KordenaCommercialConnectorError(
        "integration.kordena_control_tenant_denied",
      );
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
      return await this.fetcher(
        `${sourceBaseUrl(source, this.allowedOrigins())}${path}`,
        {
          ...init,
          headers,
          signal: controller.signal,
        },
      );
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
