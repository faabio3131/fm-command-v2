import { sanitizeAuditMetadata } from "@/application/audit/sanitize-audit-metadata";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

export async function recordAuditEvent(context: TenantContext, input: {
  action: string; resourceType: string; resourceId?: string;
  result: "allowed"|"denied"|"success"|"failure"; metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditEvents).values({
    tenantId: context.tenantId, actorId: context.userId, actorType: "user",
    action: input.action, resourceType: input.resourceType, resourceId: input.resourceId,
    result: input.result,
    correlationId: context.correlationId,
    metadata: sanitizeAuditMetadata(input.metadata ?? {}),
  });
}
