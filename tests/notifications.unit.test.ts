import { describe, expect, it } from "vitest";
import { NotificationService } from "@/application/notifications/notification-service";
import { NotificationNotFoundError } from "@/domain/notifications/contracts";
import type { ActivityProjectionRecord } from "@/domain/activity/contracts";
import type { AlertOccurrence } from "@/domain/alerts/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

const owner: TenantContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  role: "owner",
  correlationId: "corr-a",
};

function activity(
  id: string,
  eventType: string,
  createdAt: string,
  overrides: Partial<ActivityProjectionRecord> = {},
): ActivityProjectionRecord {
  return {
    id,
    category: "operations",
    eventType,
    title: "Evento " + eventType,
    occurredAt: new Date(createdAt),
    sourceAuthority: "canonical_fact",
    provenanceRefs: ["fact:" + id],
    ...overrides,
  };
}

function alert(
  id: string,
  severity: AlertOccurrence["severity"],
  status: AlertOccurrence["status"] = "active",
): AlertOccurrence {
  return {
    id,
    tenantId: "tenant-a",
    ruleId: "rule-" + id,
    metricId: "service.error.count",
    observedValue: "12",
    threshold: "10",
    operator: "gt",
    severity,
    evidenceRefs: ["metric:" + id],
    fingerprint: "fingerprint-" + id,
    occurredAt: new Date("2026-10-04T12:00:00Z"),
    status,
  };
}

function service(options?: {
  readIds?: readonly string[];
  actionCounter?: { value: number };
  marked?: Array<{ tenantId: string; userId: string; notificationId: string }>;
}) {
  return new NotificationService(
    {
      async project({ tenantId }) {
        expect(tenantId).toBe("tenant-a");
        return [
          activity("incident-1", "incident.opened", "2026-10-04T11:59:00Z"),
          activity("integration-1", "integration.failed", "2026-10-04T11:58:00Z"),
          activity("provider-1", "provider.status", "2026-10-04T11:57:00Z"),
          activity(
            "subscription-1",
            "subscription.cancelled",
            "2026-10-04T11:56:00Z",
            { category: "commercial" },
          ),
          activity("noise-1", "core.query", "2026-10-04T11:55:00Z"),
        ];
      },
    },
    {
      async listOccurrences(tenantId) {
        expect(tenantId).toBe("tenant-a");
        return [
          alert("critical-1", "critical"),
          alert("warning-1", "warning", "acknowledged"),
        ];
      },
    },
    {
      async readIds(tenantId, userId) {
        expect(tenantId).toBe("tenant-a");
        expect(userId).toBe("user-a");
        return new Set(options?.readIds ?? []);
      },
      async markRead(input) {
        options?.marked?.push({
          tenantId: input.tenantId,
          userId: input.userId,
          notificationId: input.notificationId,
        });
        return { created: true, readAt: new Date() };
      },
      async listUserActionEvents(tenantId, userId) {
        if (options?.actionCounter) options.actionCounter.value += 1;
        expect(tenantId).toBe("tenant-a");
        expect(userId).toBe("user-a");
        return [
          {
            id: "action:1",
            kind: "action_required",
            title: "Ação governada requer atenção",
            description: "Revisão necessária.",
            createdAt: new Date("2026-10-04T12:01:00Z"),
            sourceEvent: "audit_event:action-1",
            sourceAuthority: "audit_ledger",
            href: "/dashboard/alerts",
          },
        ];
      },
    },
  );
}

describe("CME-06 Notification Service", () => {
  it("compõe somente eventos governados elegíveis e preserva ack/read reais", async () => {
    const inbox = await service({
      readIds: ["alert:critical-1"],
    }).inbox(owner, 50);

    expect(inbox.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "critical_alert",
        "operational_warning",
        "integration_failure",
        "incident",
        "action_required",
        "state_change",
      ]),
    );
    expect(inbox.items.some((item) => item.id === "event:noise-1")).toBe(false);

    const critical = inbox.items.find((item) => item.id === "alert:critical-1");
    expect(critical?.read).toBe(true);
    expect(critical?.acknowledged).toBe(false);

    const warning = inbox.items.find((item) => item.id === "alert:warning-1");
    expect(warning?.acknowledged).toBe(true);
    expect(inbox.unreadCount).toBe(inbox.totalCount - 1);
    expect(inbox.dataBoundary).toContain("não executam ações");
  });

  it("não amplia autoridade de viewer para provider/action intents", async () => {
    const actionCounter = { value: 0 };
    const inbox = await service({ actionCounter }).inbox(
      { ...owner, role: "viewer" },
      50,
    );

    expect(actionCounter.value).toBe(0);
    expect(inbox.items.some((item) => item.id === "event:provider-1")).toBe(false);
    expect(inbox.items.some((item) => item.kind === "action_required")).toBe(false);
    expect(inbox.items.some((item) => item.kind === "incident")).toBe(true);
    expect(inbox.items.some((item) => item.kind === "integration_failure")).toBe(true);
    expect(
      inbox.items.find((item) => item.kind === "integration_failure")?.href,
    ).toBe("/dashboard/operations");
  });

  it("marca como lida somente notificação visível no tenant/usuário atual", async () => {
    const marked: Array<{
      tenantId: string;
      userId: string;
      notificationId: string;
    }> = [];
    const notifications = service({ marked });

    await expect(
      notifications.markRead(owner, "alert:critical-1"),
    ).resolves.toEqual({
      notificationId: "alert:critical-1",
      status: "read",
    });
    expect(marked).toEqual([
      {
        tenantId: "tenant-a",
        userId: "user-a",
        notificationId: "alert:critical-1",
      },
    ]);

    await expect(
      notifications.markRead(owner, "alert:not-visible"),
    ).rejects.toBeInstanceOf(NotificationNotFoundError);
  });
});
