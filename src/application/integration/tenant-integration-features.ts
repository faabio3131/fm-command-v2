import type { SourceRepository } from "@/domain/integration/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";
import { requirePermission } from "@/domain/security/tenant-context";
import { KORDENA_COMMERCIAL_SOURCE_TYPE } from "@/infrastructure/integration/kordena-commercial-connector";

export interface TenantIntegrationFeatures {
  readonly kordenaCommercial: boolean;
}

export async function loadTenantIntegrationFeatures(
  context: TenantContext,
  sources?: SourceRepository,
): Promise<TenantIntegrationFeatures> {
  requirePermission(context, "integration:read");

  const repository =
    sources ??
    new (await import(
      "@/infrastructure/integration/postgres-repositories"
    )).PostgresSourceRepository();

  const configured = await repository.list(context.tenantId);
  return {
    kordenaCommercial: configured.some(
      (source) => source.sourceType === KORDENA_COMMERCIAL_SOURCE_TYPE,
    ),
  };
}
