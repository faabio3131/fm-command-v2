import type { SourceDefinition } from "@/domain/integration/contracts";
import {
  CrossTenantAccessError,
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import {
  KORDENA_COMMERCIAL_SOURCE_TYPE,
  type KordenaBillingCommand,
  type KordenaBillingOverview,
} from "@/infrastructure/integration/kordena-commercial-connector";
import { KordenaBillingConnector } from "@/infrastructure/integration/kordena-billing-connector";

export class KordenaBillingSourceError extends Error {
  constructor(code = "integration.kordena_billing_source_invalid") {
    super(code);
  }
}

export class KordenaBillingControlService {
  constructor(
    private readonly sources = new PostgresSourceRepository(),
    private readonly connector = new KordenaBillingConnector(),
  ) {}

  async overview(
    context: TenantContext,
    sourceId: string,
  ): Promise<KordenaBillingOverview> {
    requirePermission(context, "billing:read");
    const source = await this.source(context, sourceId);
    return this.connector.overview(this.connectorContext(context), source);
  }

  async command(
    context: TenantContext,
    input: {
      sourceId: string;
      command: KordenaBillingCommand;
      idempotencyKey?: string;
    },
  ): Promise<Record<string, unknown>> {
    requirePermission(context, "billing:write");
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
      throw new KordenaBillingSourceError();
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
