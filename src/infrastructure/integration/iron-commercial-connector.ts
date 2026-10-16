import {
  RetryableConnectorError,
  type Connector,
  type ConnectorContext,
  type ConnectorFact,
  type ConnectorPullResult,
  type SourceDefinition,
} from "@/domain/integration/contracts";

export const IRON_COMMERCIAL_SOURCE_TYPE = "iron-commercial-v1";
export const IRON_COMMERCIAL_SECRET_REF = "env:FMCC_IRON_CONTROL_PLANE_TOKEN";

export type IronSecretResolver = (reference: string) => string | undefined;
export type IronAllowedOriginResolver = () => readonly string[];
export type IronControlTenantResolver = () => string | undefined;

export interface IronCommercialSnapshot {
  readonly schema_version: "iron.fmcc.commercial.v1";
  readonly product_code: "IRON_FIT_CORE";
  readonly as_of: string;
  readonly customers: readonly Record<string, unknown>[];
  readonly trials: readonly Record<string, unknown>[];
  readonly subscriptions: readonly Record<string, unknown>[];
  readonly entitlements: readonly Record<string, unknown>[];
  readonly onboarding: readonly Record<string, unknown>[];
  readonly billing_transactions: readonly Record<string, unknown>[];
  readonly summary: Readonly<Record<string, number>>;
  readonly facts: readonly {
    external_id: string;
    fact_type: string;
    payload: Record<string, unknown>;
    source_timestamp: string;
  }[];
  readonly coverage: Readonly<Record<string, string>>;
}

export interface IronSubscriptionCommand {
  readonly action: "subscription.status.sync" | "subscription.plan.transition";
  readonly gymId: string;
  readonly expectedSubscriptionId: string;
  readonly commercialStatus:
    | "active"
    | "grace"
    | "delinquent"
    | "suspended"
    | "cancelled"
    | "renewal"
    | "upgrade"
    | "downgrade";
  readonly entitlementStatus?: "ACTIVE" | "SUSPENDED" | "CANCELED";
  readonly planCode?: string;
  readonly planVersion?: number;
  readonly transitionKind?: "UPGRADE" | "DOWNGRADE" | "PLAN_CHANGE";
  readonly reason: string;
}

export class IronCommercialConnectorError extends Error {
  constructor(code = "integration.iron_commercial_failure") {
    super(code);
  }
}

export function environmentIronSecretResolver(reference: string): string | undefined {
  if (!reference.startsWith("env:")) {
    throw new IronCommercialConnectorError("integration.iron_secret_reference_unsupported");
  }
  const name = reference.slice(4).trim();
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(name)) {
    throw new IronCommercialConnectorError("integration.iron_secret_reference_invalid");
  }
  return process.env[name]?.trim() || undefined;
}

export function environmentIronControlTenantId(): string | undefined {
  return process.env.FMCC_IRON_CONTROL_TENANT_ID?.trim() || undefined;
}

export function environmentIronAllowedOrigins(): readonly string[] {
  return (process.env.FMCC_IRON_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin);
}

function baseUrl(source: SourceDefinition, allowedOrigins: readonly string[]): string {
  const raw = source.config.baseUrl;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new IronCommercialConnectorError("integration.iron_base_url_missing");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new IronCommercialConnectorError("integration.iron_base_url_invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new IronCommercialConnectorError("integration.iron_base_url_insecure");
  }
  const allowed = new Set(allowedOrigins.map((value) => new URL(value).origin));
  if (!allowed.has(parsed.origin)) {
    throw new IronCommercialConnectorError("integration.iron_origin_not_allowed");
  }
  return parsed.toString().replace(/\/$/, "");
}

function token(source: SourceDefinition, resolver: IronSecretResolver): string {
  if (source.secretRef !== IRON_COMMERCIAL_SECRET_REF) {
    throw new IronCommercialConnectorError("integration.iron_secret_reference_invalid");
  }
  const value = resolver(source.secretRef)?.trim();
  if (!value || value.length < 32) {
    throw new IronCommercialConnectorError("integration.iron_service_token_unavailable");
  }
  return value;
}

function connectorFact(value: unknown): ConnectorFact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IronCommercialConnectorError("integration.iron_fact_invalid");
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.external_id !== "string" ||
    typeof item.fact_type !== "string" ||
    !item.payload ||
    typeof item.payload !== "object" ||
    Array.isArray(item.payload) ||
    typeof item.source_timestamp !== "string"
  ) {
    throw new IronCommercialConnectorError("integration.iron_fact_invalid");
  }
  const timestamp = new Date(item.source_timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new IronCommercialConnectorError("integration.iron_fact_timestamp_invalid");
  }
  return {
    externalId: item.external_id,
    factType: item.fact_type,
    payload: item.payload as Record<string, unknown>,
    sourceTimestamp: timestamp,
  };
}

export class IronCommercialConnector implements Connector {
  readonly sourceType = IRON_COMMERCIAL_SOURCE_TYPE;
  readonly capabilities = [
    "commercial.snapshot",
    "commercial.facts",
    "commercial.subscription.commands",
  ] as const;

  constructor(
    private readonly resolveSecret: IronSecretResolver = environmentIronSecretResolver,
    private readonly fetcher: typeof fetch = fetch,
    private readonly allowedOrigins: IronAllowedOriginResolver = environmentIronAllowedOrigins,
    private readonly controlTenantId: IronControlTenantResolver = environmentIronControlTenantId,
  ) {}

  async health(
    context: ConnectorContext,
    source: SourceDefinition,
  ): Promise<"healthy" | "degraded" | "unavailable"> {
    try {
      const response = await this.request(context, source, "/api/v1/control-plane/fmcc/health");
      return response.ok ? "healthy" : "degraded";
    } catch {
      return "unavailable";
    }
  }

  async pull(
    context: ConnectorContext,
    source: SourceDefinition,
  ): Promise<ConnectorPullResult> {
    const snapshot = await this.snapshot(context, source);
    return {
      facts: snapshot.facts.map(connectorFact),
      nextCursor: snapshot.as_of,
    };
  }

  async snapshot(
    context: ConnectorContext,
    source: SourceDefinition,
  ): Promise<IronCommercialSnapshot> {
    const response = await this.request(context, source, "/api/v1/control-plane/fmcc/snapshot");
    if (!response.ok) {
      throw new IronCommercialConnectorError("integration.iron_snapshot_unavailable");
    }
    const body = (await response.json()) as Partial<IronCommercialSnapshot>;
    const collections = [
      body.customers,
      body.trials,
      body.subscriptions,
      body.entitlements,
      body.onboarding,
      body.billing_transactions,
      body.facts,
    ];
    if (
      body.schema_version !== "iron.fmcc.commercial.v1" ||
      body.product_code !== "IRON_FIT_CORE" ||
      typeof body.as_of !== "string" ||
      Number.isNaN(new Date(body.as_of).getTime()) ||
      collections.some((item) => !Array.isArray(item)) ||
      !body.summary ||
      typeof body.summary !== "object" ||
      !body.coverage ||
      typeof body.coverage !== "object"
    ) {
      throw new IronCommercialConnectorError("integration.iron_snapshot_contract_invalid");
    }
    return body as IronCommercialSnapshot;
  }

  async subscriptionCommand(
    context: ConnectorContext,
    source: SourceDefinition,
    command: IronSubscriptionCommand,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    if (!idempotencyKey.trim()) {
      throw new IronCommercialConnectorError("integration.iron_idempotency_key_missing");
    }
    const response = await this.request(
      context,
      source,
      "/api/v1/control-plane/fmcc/subscription/commands",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok) {
      throw new IronCommercialConnectorError("integration.iron_subscription_command_rejected");
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private async request(
    context: ConnectorContext,
    source: SourceDefinition,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const allowedTenant = this.controlTenantId();
    if (!allowedTenant || context.tenantId !== allowedTenant) {
      throw new IronCommercialConnectorError("integration.iron_control_tenant_denied");
    }
    if (
      source.tenantId !== context.tenantId ||
      source.sourceType !== IRON_COMMERCIAL_SOURCE_TYPE ||
      source.secretRef !== IRON_COMMERCIAL_SECRET_REF ||
      source.authoritativeDomain !== "commercial" ||
      source.productId === undefined
    ) {
      throw new IronCommercialConnectorError("integration.iron_source_scope_denied");
    }
    if (!Number.isFinite(context.timeoutMs) || context.timeoutMs < 1 || context.timeoutMs > 120_000) {
      throw new IronCommercialConnectorError("integration.iron_timeout_invalid");
    }

    const headers = new Headers(init.headers);
    headers.set("authorization", "Bearer " + token(source, this.resolveSecret));
    headers.set("x-correlation-id", context.correlationId);

    const controller = new AbortController();
    const upstreamSignal = init.signal;
    const abortFromUpstream = () => controller.abort();
    if (upstreamSignal?.aborted) controller.abort();
    else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    const timer = setTimeout(() => controller.abort(), context.timeoutMs);
    try {
      const response = await this.fetcher(baseUrl(source, this.allowedOrigins()) + path, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (response.status === 429 || response.status >= 500) {
        throw new RetryableConnectorError("integration.iron_upstream_retryable");
      }
      return response;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new IronCommercialConnectorError("integration.iron_request_timeout");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  }
}
