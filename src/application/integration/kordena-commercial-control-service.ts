import type { SourceDefinition } from "@/domain/integration/contracts";
import {
  CrossTenantAccessError,
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import {
  KORDENA_COMMERCIAL_SOURCE_TYPE,
  KordenaCommercialConnector,
  type KordenaCommercialCommand,
  type KordenaCommercialSnapshot,
} from "@/infrastructure/integration/kordena-commercial-connector";

export class KordenaCommercialSourceError extends Error {
  constructor(code = "integration.kordena_commercial_source_invalid") {
    super(code);
  }
}

export class KordenaCommercialControlService {
  constructor(
    private readonly sources = new PostgresSourceRepository(),
    private readonly connector = new KordenaCommercialConnector(),
  ) {}

  async snapshot(
    context: TenantContext,
    sourceId: string,
  ): Promise<KordenaCommercialSnapshot> {
    requirePermission(context, "commercial:read");
    const source = await this.source(context, sourceId);
    return this.connector.snapshot(this.connectorContext(context), source);
  }

  async command(
    context: TenantContext,
    input: {
      sourceId: string;
      command: KordenaCommercialCommand;
      idempotencyKey: string;
    },
  ): Promise<Record<string, unknown>> {
    requirePermission(context, "commercial:write");
    const source = await this.source(context, input.sourceId);
    return this.connector.command(
      this.connectorContext(context),
      source,
      input.command,
      input.idempotencyKey,
    );
  }

  private async source(
    context: TenantContext,
    sourceId: string,
  ): Promise<SourceDefinition> {
    const source = await this.sources.findById(context.tenantId, sourceId);
    if (!source || source.tenantId !== context.tenantId) {
      throw new CrossTenantAccessError();
    }
    if (source.sourceType !== KORDENA_COMMERCIAL_SOURCE_TYPE) {
      throw new KordenaCommercialSourceError();
    }
    return source;
  }

  private connectorContext(context: TenantContext) {
    return {
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      timeoutMs: 8_000,
    };
  }
}
