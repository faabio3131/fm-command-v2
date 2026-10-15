import type { SourceDefinition, SourceRepository } from "@/domain/integration/contracts";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

/**
 * Internal source lookup for commercial read capabilities.
 *
 * It deliberately does not expose the Source Registry administrative list.
 * The repository lookup remains tenant-scoped and commercial:read is the
 * only capability granted to callers of this resolver.
 */
export class CommercialSourceResolver {
  constructor(private readonly sources: SourceRepository) {}

  async findByType(
    context: TenantContext,
    sourceType: string,
  ): Promise<SourceDefinition | null> {
    requirePermission(context, "commercial:read");
    const sources = await this.sources.list(context.tenantId);
    return (
      sources.find(
        (source) =>
          source.tenantId === context.tenantId &&
          source.sourceType === sourceType,
      ) ?? null
    );
  }
}
