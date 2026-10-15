import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { PostgresNotificationStateRepository } from "@/infrastructure/notifications/postgres-notification-state-repository";

const TENANTS = ["cme06-tenant-a", "cme06-tenant-b"];

afterEach(async () => {
  for (const tenantId of TENANTS) {
    await db.delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  }
});

describe("CME-06 notification state PostgreSQL", () => {
  it("isola estado de leitura por tenant e usuário com idempotência", async () => {
    const repository = new PostgresNotificationStateRepository();

    const first = await repository.markRead({
      tenantId: TENANTS[0],
      userId: "user-a",
      notificationId: "alert:occurrence-1",
      correlationId: "corr-read-1",
    });
    const second = await repository.markRead({
      tenantId: TENANTS[0],
      userId: "user-a",
      notificationId: "alert:occurrence-1",
      correlationId: "corr-read-2",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const own = await repository.readIds(
      TENANTS[0],
      "user-a",
      ["alert:occurrence-1"],
    );
    const otherUser = await repository.readIds(
      TENANTS[0],
      "user-b",
      ["alert:occurrence-1"],
    );
    const otherTenant = await repository.readIds(
      TENANTS[1],
      "user-a",
      ["alert:occurrence-1"],
    );

    expect(own.has("alert:occurrence-1")).toBe(true);
    expect(otherUser.has("alert:occurrence-1")).toBe(false);
    expect(otherTenant.has("alert:occurrence-1")).toBe(false);
  });

  it("retorna ação que requer atenção somente para o próprio usuário", async () => {
    await db.insert(auditEvents).values([
      {
        tenantId: TENANTS[0],
        actorId: "user-a",
        actorType: "user",
        action: "action.intent.prepared",
        resourceType: "governed_action_intent",
        resourceId: "intent-a",
        result: "success",
        correlationId: "corr-a",
        metadata: {},
        occurredAt: new Date("2026-10-04T12:00:00Z"),
      },
      {
        tenantId: TENANTS[0],
        actorId: "user-b",
        actorType: "user",
        action: "action.intent.prepared",
        resourceType: "governed_action_intent",
        resourceId: "intent-b",
        result: "success",
        correlationId: "corr-b",
        metadata: {},
        occurredAt: new Date("2026-10-04T12:01:00Z"),
      },
      {
        tenantId: TENANTS[1],
        actorId: "user-a",
        actorType: "user",
        action: "action.intent.prepared",
        resourceType: "governed_action_intent",
        resourceId: "intent-other",
        result: "success",
        correlationId: "corr-other",
        metadata: {},
        occurredAt: new Date("2026-10-04T12:02:00Z"),
      },
    ]);

    const repository = new PostgresNotificationStateRepository();
    const events = await repository.listUserActionEvents(
      TENANTS[0],
      "user-a",
      10,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "action_required",
      sourceAuthority: "audit_ledger",
      href: "/dashboard/alerts",
    });
    expect(events[0].sourceEvent).toMatch(/^audit_event:/);
  });
});
