export type ConnectorSyncMode = "pull" | "webhook" | "hybrid";
export type SourceStatus =
  | "configured"
  | "healthy"
  | "degraded"
  | "unavailable";

export interface SourceDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly productId?: string;
  readonly name: string;
  readonly sourceType: string;
  readonly authoritativeDomain: string;
  readonly status: SourceStatus;
  readonly syncMode: ConnectorSyncMode;
  readonly secretRef?: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly freshnessSeconds?: number;
  readonly mappingVersion: string;
}

export interface NewSourceDefinition {
  readonly productId?: string;
  readonly name: string;
  readonly sourceType: string;
  readonly authoritativeDomain: string;
  readonly syncMode: ConnectorSyncMode;
  readonly secretRef?: string;
  readonly mappingVersion?: string;
  readonly freshnessSeconds?: number;
  readonly config?: Record<string, unknown>;
}

export interface ConnectorFact {
  readonly externalId: string;
  readonly factType: string;
  readonly payload: Record<string, unknown>;
  readonly sourceTimestamp: Date;
  /**
   * Identificador da unidade no sistema de origem (filial, departamento).
   * O runtime o traduz para a unidade do Command pelo mapa configurado na
   * fonte; sem mapa, o dado entra sem unidade (nunca atribuído por palpite).
   */
  readonly unitRef?: string;
}

export interface ConnectorPullResult {
  readonly facts: readonly ConnectorFact[];
  readonly nextCursor?: string;
  readonly rateLimitRemaining?: number;
  /** Registros que o conector leu mas não pôde converter (ex.: sem identificador). */
  readonly skipped?: number;
}

export interface ConnectorContext {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly timeoutMs: number;
}

export interface Connector {
  readonly sourceType: string;
  readonly capabilities: readonly string[];
  health(
    context: ConnectorContext,
    source: SourceDefinition,
  ): Promise<"healthy" | "degraded" | "unavailable">;
  pull?(
    context: ConnectorContext,
    source: SourceDefinition,
    cursor?: string,
  ): Promise<ConnectorPullResult>;
}

export class RetryableConnectorError extends Error {
  constructor(message = "integration.connector_retryable_error") {
    super(message);
    this.name = "RetryableConnectorError";
  }
}

/** Credencial inválida, revogada ou sem permissão no sistema de origem. Não se repete sozinha. */
export class ConnectorAuthError extends Error {
  constructor(message = "integration.connector_auth_error") {
    super(message);
    this.name = "ConnectorAuthError";
  }
}

/** O sistema de origem pediu para esperar. Repetir agora agrava o bloqueio. */
export class ConnectorRateLimitedError extends Error {
  constructor(
    readonly retryAfterSeconds?: number,
    message = "integration.connector_rate_limited",
  ) {
    super(message);
    this.name = "ConnectorRateLimitedError";
  }
}

/** Fonte mal configurada ou cursor inválido. Corrigir a configuração, não repetir. */
export class ConnectorConfigError extends Error {
  constructor(message = "integration.connector_config_invalid") {
    super(message);
    this.name = "ConnectorConfigError";
  }
}

export interface SourceRepository {
  findById(
    tenantId: string,
    sourceId: string,
  ): Promise<SourceDefinition | null>;
  list(tenantId: string): Promise<readonly SourceDefinition[]>;
  create(
    tenantId: string,
    input: NewSourceDefinition,
  ): Promise<SourceDefinition>;
}

export interface SourceStatusWriter {
  updateStatus(
    tenantId: string,
    sourceId: string,
    status: SourceStatus,
  ): Promise<void>;
}

export interface SyncOperationalState {
  readonly lastAttemptAt?: Date;
  readonly lastAttemptStatus?: "running" | "completed" | "failed";
  readonly lastSuccessfulAt?: Date;
  readonly lastSuccessfulCursor?: string;
}

export interface SyncRepository {
  begin(input: {
    tenantId: string;
    sourceId: string;
    idempotencyKey: string;
    correlationId: string;
    cursorBefore?: string;
  }): Promise<{
    id: string;
    state: "started" | "restarted" | "running" | "completed";
  }>;
  complete(input: {
    id: string;
    tenantId: string;
    cursorAfter?: string;
  }): Promise<void>;
  fail(input: {
    id: string;
    tenantId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}

export interface SyncOperationalReader {
  operationalState(
    tenantId: string,
    sourceId: string,
  ): Promise<SyncOperationalState>;
}

export interface CanonicalFactRepository {
  ingest(input: {
    tenantId: string;
    productId?: string;
    sourceId: string;
    mappingVersion: string;
    fact: ConnectorFact;
    unitId?: string;
    correlationId: string;
  }): Promise<void>;
}
