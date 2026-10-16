import type { SourceDefinition } from "@/domain/integration/contracts";
import {
  CrossTenantAccessError,
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";
import {
  KORDENA_COMMERCIAL_SOURCE_TYPE,
} from "@/infrastructure/integration/kordena-commercial-connector";
import {
  KordenaPlatformIntegrationConnector,
  type KordenaPlatformActor,
  type KordenaPlatformHealthcheck,
  type KordenaPlatformIntegrationConfigInput,
  type KordenaPlatformIntegrationConfiguration,
  type KordenaPlatformIntegrationsOverview,
} from "@/infrastructure/integration/kordena-platform-integration-connector";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";

export class KordenaPlatformIntegrationSourceError extends Error {
  constructor(code = "integration.kordena_platform_source_invalid") {
    super(code);
  }
}

export class KordenaPlatformIntegrationControlService {
  constructor(
    private readonly sources = new PostgresSourceRepository(),
    private readonly connector = new KordenaPlatformIntegrationConnector(),
  ) {}

  async overview(
    context: TenantContext,
    sourceId: string,
  ): Promise<KordenaPlatformIntegrationsOverview> {
    requirePermission(context, "integration:read");
    return this.connector.overview(
      this.connectorContext(context),
      await this.source(context, sourceId),
    );
  }

  async configure(
    context: TenantContext,
    input: {
      sourceId: string;
      configId: string;
      actor: KordenaPlatformActor;
      configuracao: KordenaPlatformIntegrationConfigInput;
    },
  ): Promise<KordenaPlatformIntegrationConfiguration> {
    requirePermission(context, "integration:write");
    return this.connector.configure(
      this.connectorContext(context),
      await this.source(context, input.sourceId),
      input,
    );
  }

  async healthcheck(
    context: TenantContext,
    input: {
      sourceId: string;
      configId: string;
      actor: KordenaPlatformActor;
    },
  ): Promise<KordenaPlatformHealthcheck> {
    requirePermission(context, "integration:write");
    return this.connector.healthcheck(
      this.connectorContext(context),
      await this.source(context, input.sourceId),
      input,
    );
  }

  async homologate(
    context: TenantContext,
    input: {
      sourceId: string;
      configId: string;
      actor: KordenaPlatformActor;
      evidenceRef: string;
    },
  ): Promise<KordenaPlatformIntegrationConfiguration> {
    requirePermission(context, "integration:write");
    return this.connector.homologate(
      this.connectorContext(context),
      await this.source(context, input.sourceId),
      input,
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
      throw new KordenaPlatformIntegrationSourceError();
    }
    return source;
  }

  private connectorContext(context: TenantContext) {
    return {
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      timeoutMs: 25_000,
    };
  }
}
