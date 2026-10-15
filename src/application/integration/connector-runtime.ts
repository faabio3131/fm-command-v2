import {
  RetryableConnectorError,
  type CanonicalFactRepository,
  type Connector,
  type SourceRepository,
  type SourceStatusWriter,
  type SyncRepository,
} from "@/domain/integration/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";
import {
  CrossTenantAccessError,
  requirePermission,
} from "@/domain/security/tenant-context";
import { logEvent } from "@/infrastructure/observability/logger";

export { RetryableConnectorError } from "@/domain/integration/contracts";

export class ConnectorNotRegisteredError extends Error {
  constructor(sourceType: string) {
    super(`integration.connector_not_registered:${sourceType}`);
  }
}
export class ConnectorUnsupportedModeError extends Error {
  constructor() {
    super("integration.connector_pull_not_supported");
  }
}
export class ConnectorTimeoutError extends Error {
  constructor() {
    super("integration.connector_timeout");
  }
}

function safeConnectorFailure(
  error: unknown,
): { errorCode: string; errorMessage: string } {
  if (error instanceof ConnectorTimeoutError) {
    return {
      errorCode: error.name,
      errorMessage: "integration.connector_timeout",
    };
  }
  if (error instanceof RetryableConnectorError) {
    return {
      errorCode: error.name,
      errorMessage: "integration.connector_retryable_error",
    };
  }
  if (error instanceof ConnectorUnsupportedModeError) {
    return {
      errorCode: error.name,
      errorMessage: "integration.connector_pull_not_supported",
    };
  }
  if (error instanceof ConnectorNotRegisteredError) {
    return {
      errorCode: error.name,
      errorMessage: "integration.connector_not_registered",
    };
  }
  return {
    errorCode: error instanceof Error ? error.name : "UnknownError",
    errorMessage: "integration.connector_failure",
  };
}

export class ConnectorRuntime {
  private readonly connectors = new Map<string, Connector>();

  constructor(
    private readonly sources: SourceRepository & Partial<SourceStatusWriter>,
    private readonly syncs: SyncRepository,
    private readonly facts: CanonicalFactRepository,
    connectors: readonly Connector[],
    private readonly timeoutMs = 8_000,
    private readonly maxAttempts = 3,
    private readonly retryDelayMs = 100,
  ) {
    for (const connector of connectors) {
      this.connectors.set(connector.sourceType, connector);
    }
  }

  async health(context: TenantContext, sourceId: string) {
    requirePermission(context, "integration:read");
    const source = await this.sources.findById(context.tenantId, sourceId);
    if (!source || source.tenantId !== context.tenantId) {
      throw new CrossTenantAccessError();
    }
    const connector = this.connectors.get(source.sourceType);
    if (!connector) {
      throw new ConnectorNotRegisteredError(source.sourceType);
    }

    try {
      const status = await this.withTimeout(
        connector.health(
          {
            tenantId: context.tenantId,
            correlationId: context.correlationId,
            timeoutMs: this.timeoutMs,
          },
          source,
        ),
      );
      await this.sources.updateStatus?.(
        context.tenantId,
        source.id,
        status,
      );
      return status;
    } catch (error) {
      try {
        await this.sources.updateStatus?.(
          context.tenantId,
          source.id,
          "unavailable",
        );
      } catch {
        // A persistence failure must not hide the connector failure.
      }
      throw error;
    }
  }

  async syncPull(
    context: TenantContext,
    input: {
      sourceId: string;
      cursor?: string;
      idempotencyKey: string;
    },
  ) {
    requirePermission(context, "integration:write");
    const source = await this.sources.findById(
      context.tenantId,
      input.sourceId,
    );
    if (!source || source.tenantId !== context.tenantId) {
      throw new CrossTenantAccessError();
    }
    if (source.syncMode === "webhook") {
      throw new ConnectorUnsupportedModeError();
    }

    const connector = this.connectors.get(source.sourceType);
    if (!connector) {
      throw new ConnectorNotRegisteredError(source.sourceType);
    }
    if (!connector.pull) {
      throw new ConnectorUnsupportedModeError();
    }

    const execution = await this.syncs.begin({
      tenantId: context.tenantId,
      sourceId: source.id,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
      cursorBefore: input.cursor,
    });
    if (execution.state === "completed") {
      return {
        status: "duplicate" as const,
        executionId: execution.id,
        ingested: 0,
      };
    }
    if (execution.state === "running") {
      return {
        status: "in_progress" as const,
        executionId: execution.id,
        ingested: 0,
      };
    }

    const executionId = execution.id;
    logEvent(
      "info",
      execution.state === "restarted"
        ? "connector_sync_restarted"
        : "connector_sync_started",
      {
        tenantId: context.tenantId,
        sourceId: source.id,
        executionId,
        correlationId: context.correlationId,
      },
    );

    try {
      const result = await this.pullWithRetry(
        connector,
        source,
        context,
        input.cursor,
      );
      for (const fact of result.facts) {
        await this.facts.ingest({
          tenantId: context.tenantId,
          productId: source.productId,
          sourceId: source.id,
          mappingVersion: source.mappingVersion,
          fact,
          correlationId: context.correlationId,
        });
      }
      await this.syncs.complete({
        id: executionId,
        tenantId: context.tenantId,
        cursorAfter: result.nextCursor,
      });
      logEvent("info", "connector_sync_completed", {
        tenantId: context.tenantId,
        sourceId: source.id,
        executionId,
        correlationId: context.correlationId,
        ingested: result.facts.length,
        rateLimitRemaining: result.rateLimitRemaining,
      });
      return {
        status: "completed" as const,
        executionId,
        ingested: result.facts.length,
        nextCursor: result.nextCursor,
        rateLimitRemaining: result.rateLimitRemaining,
      };
    } catch (error) {
      const failure = safeConnectorFailure(error);
      await this.syncs.fail({
        id: executionId,
        tenantId: context.tenantId,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
      });
      logEvent("error", "connector_sync_failed", {
        tenantId: context.tenantId,
        sourceId: source.id,
        executionId,
        correlationId: context.correlationId,
        errorCode: failure.errorCode,
      });
      throw error;
    }
  }

  private async pullWithRetry(
    connector: Connector,
    source: NonNullable<
      Awaited<ReturnType<SourceRepository["findById"]>>
    >,
    context: TenantContext,
    cursor?: string,
  ) {
    if (!connector.pull) {
      throw new ConnectorUnsupportedModeError();
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.withTimeout(
          connector.pull(
            {
              tenantId: context.tenantId,
              correlationId: context.correlationId,
              timeoutMs: this.timeoutMs,
            },
            source,
            cursor,
          ),
        );
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof RetryableConnectorError ||
          error instanceof ConnectorTimeoutError;
        if (!retryable || attempt === this.maxAttempts) {
          throw error;
        }
        logEvent("warn", "connector_sync_retry", {
          tenantId: context.tenantId,
          sourceId: source.id,
          correlationId: context.correlationId,
          attempt,
          maxAttempts: this.maxAttempts,
        });
        if (this.retryDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              this.retryDelayMs * 2 ** (attempt - 1),
            ),
          );
        }
      }
    }
    throw lastError;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new ConnectorTimeoutError()),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
