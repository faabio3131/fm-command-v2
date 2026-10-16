import { and, desc, eq } from "drizzle-orm";
import type { CoreOperationalContext } from "@/domain/core/contracts";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export interface CoreContextReader {
  recent(input: { tenantId: string; userId: string; limit?: number }): Promise<readonly CoreOperationalContext[]>;
}

export class AuditCoreContextReader implements CoreContextReader {
  async recent(input: { tenantId: string; userId: string; limit?: number }): Promise<readonly CoreOperationalContext[]> {
    const limit = Math.min(Math.max(input.limit ?? 6, 1), 16);
    const rows = await db
      .select({ metadata: auditEvents.metadata, occurredAt: auditEvents.occurredAt })
      .from(auditEvents)
      .where(and(
        eq(auditEvents.tenantId, input.tenantId),
        eq(auditEvents.actorId, input.userId),
        eq(auditEvents.action, "core.query"),
        eq(auditEvents.result, "success"),
      ))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(limit);

    return rows.flatMap((row) => {
      const question = readString(row.metadata.question);
      const answer = readString(row.metadata.answer);
      const factualStatus = readString(row.metadata.factualStatus);
      if (!question || !answer || (factualStatus !== "grounded" && factualStatus !== "unavailable")) return [];
      return [{
        question,
        answer,
        factualStatus,
        evidenceRefs: readStringArray(row.metadata.evidenceRefs),
        occurredAt: row.occurredAt.toISOString(),
      } satisfies CoreOperationalContext];
    }).reverse();
  }
}
