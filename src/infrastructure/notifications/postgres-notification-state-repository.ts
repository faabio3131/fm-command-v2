import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  NotificationCandidate,
  NotificationStateRepository,
} from "@/domain/notifications/contracts";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

const READ_ACTION = "notification.read";

function resourceId(notificationId: string): string {
  return `notification:${notificationId}`;
}

export class PostgresNotificationStateRepository
  implements NotificationStateRepository {
  async readIds(
    tenantId: string,
    userId: string,
    notificationIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (!notificationIds.length) return new Set();

    const resourceIds = notificationIds.map(resourceId);
    const rows = await db
      .select({ resourceId: auditEvents.resourceId })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenantId),
          eq(auditEvents.actorId, userId),
          eq(auditEvents.action, READ_ACTION),
          inArray(auditEvents.resourceId, resourceIds),
        ),
      );

    return new Set(
      rows.flatMap((row) => {
        const value = row.resourceId;
        return value?.startsWith("notification:")
          ? [value.slice("notification:".length)]
          : [];
      }),
    );
  }

  async markRead(input: {
    tenantId: string;
    userId: string;
    notificationId: string;
    correlationId: string;
  }): Promise<{ readonly created: boolean; readonly readAt: Date }> {
    const target = resourceId(input.notificationId);

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${input.tenantId}:${input.userId}:notification-read:${input.notificationId}`}))`,
      );

      const existing = await tx
        .select({ occurredAt: auditEvents.occurredAt })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.tenantId, input.tenantId),
            eq(auditEvents.actorId, input.userId),
            eq(auditEvents.action, READ_ACTION),
            eq(auditEvents.resourceId, target),
          ),
        )
        .limit(1);

      if (existing[0]) {
        return { created: false, readAt: existing[0].occurredAt };
      }

      const now = new Date();
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorId: input.userId,
        actorType: "user",
        action: READ_ACTION,
        resourceType: "notification_state",
        resourceId: target,
        result: "success",
        correlationId: input.correlationId,
        metadata: {
          notificationId: input.notificationId,
          readAt: now.toISOString(),
        },
        occurredAt: now,
      });

      return { created: true, readAt: now };
    });
  }

  async listUserActionEvents(
    tenantId: string,
    userId: string,
    limit: number,
  ): Promise<readonly NotificationCandidate[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const rows = await db
      .select({
        id: auditEvents.id,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenantId),
          eq(auditEvents.actorId, userId),
          eq(auditEvents.action, "action.intent.prepared"),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(safeLimit);

    return rows.map((row) => ({
      id: `action:${row.id}`,
      kind: "action_required",
      title: "Ação governada requer atenção",
      description:
        "Existe uma intenção governada preparada para revisão no fluxo de Alertas.",
      createdAt: row.occurredAt,
      sourceEvent: `audit_event:${row.id}`,
      sourceAuthority: "audit_ledger",
      href: "/dashboard/alerts",
    }));
  }
}
