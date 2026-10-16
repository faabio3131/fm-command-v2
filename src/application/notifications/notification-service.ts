import type {
  ActivityProjectionRecord,
  ActivityRepository,
} from "@/domain/activity/contracts";
import type {
  AlertOccurrence,
  AlertRepository,
} from "@/domain/alerts/contracts";
import {
  NotificationNotFoundError,
  NotificationQueryError,
  type NotificationCandidate,
  type NotificationInbox,
  type NotificationKind,
  type NotificationStateRepository,
} from "@/domain/notifications/contracts";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";

const NOTIFICATION_ID = /^[A-Za-z0-9:._-]{1,200}$/;

function hrefForEvent(eventType: string): string {
  if (eventType.startsWith("provider.")) {
    return "/dashboard/sources";
  }
  if (
    eventType.startsWith("integration.") ||
    eventType.startsWith("incident.") ||
    eventType.startsWith("job.") ||
    eventType.startsWith("service.")
  ) {
    return "/dashboard/operations";
  }
  if (eventType.startsWith("subscription.")) {
    return "/dashboard/subscriptions";
  }
  return "/dashboard/activity";
}

function activityCandidate(
  context: TenantContext,
  event: ActivityProjectionRecord,
): NotificationCandidate | null {
  let kind: NotificationKind | null = null;
  let allowed = false;

  if (event.eventType === "integration.failed") {
    kind = "integration_failure";
    allowed = roleHasPermission(context.role, "integration:read");
  } else if (event.eventType === "incident.opened") {
    kind = "incident";
    allowed = roleHasPermission(context.role, "metric:read");
  } else if (
    event.eventType === "job.failed" ||
    event.eventType === "service.error" ||
    event.eventType === "alert.automation.failed"
  ) {
    kind = "operational_warning";
    allowed =
      event.eventType.startsWith("alert.")
        ? roleHasPermission(context.role, "alert:read")
        : roleHasPermission(context.role, "metric:read");
  } else if (
    event.eventType === "provider.status" ||
    event.eventType === "subscription.cancelled"
  ) {
    kind = "state_change";
    allowed =
      event.eventType.startsWith("provider.")
        ? roleHasPermission(context.role, "source:read")
        : roleHasPermission(context.role, "metric:read");
  } else if (event.eventType === "alert.automation.completed") {
    kind = "system_info";
    allowed = roleHasPermission(context.role, "alert:read");
  }

  if (!kind || !allowed) return null;

  return {
    id: `event:${event.id}`,
    kind,
    title: event.title,
    description:
      event.result
        ? `Evento governado registrado com resultado ${event.result}.`
        : "Evento governado registrado pela fonte autoritativa.",
    createdAt: event.occurredAt,
    sourceEvent: event.id,
    sourceAuthority: event.sourceAuthority,
    href: hrefForEvent(event.eventType),
    productId: event.productId,
    severity: event.severity,
  };
}

function alertCandidate(occurrence: AlertOccurrence): NotificationCandidate {
  const kind: NotificationKind =
    occurrence.severity === "critical"
      ? "critical_alert"
      : occurrence.severity === "warning"
        ? "operational_warning"
        : "system_info";

  return {
    id: `alert:${occurrence.id}`,
    kind,
    title:
      occurrence.severity === "critical"
        ? "Alerta crítico"
        : occurrence.severity === "warning"
          ? "Alerta requer atenção"
          : "Alerta informativo",
    description: `Métrica ${occurrence.metricId} · limite ${occurrence.operator} ${occurrence.threshold}.`,
    createdAt: occurrence.occurredAt,
    sourceEvent: `alert_occurrence:${occurrence.id}`,
    sourceAuthority: "alert_repository",
    href: "/dashboard/alerts",
    productId: occurrence.productId,
    severity: occurrence.severity,
    acknowledged: occurrence.status === "acknowledged",
  };
}

function deduplicate(
  candidates: readonly NotificationCandidate[],
): readonly NotificationCandidate[] {
  const byId = new Map<string, NotificationCandidate>();
  for (const candidate of candidates) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      right.id.localeCompare(left.id),
  );
}

export class NotificationService {
  constructor(
    private readonly activities: Pick<ActivityRepository, "project">,
    private readonly alerts: Pick<AlertRepository, "listOccurrences">,
    private readonly state: NotificationStateRepository,
  ) {}

  async inbox(
    context: TenantContext,
    limit = 25,
  ): Promise<NotificationInbox> {
    requirePermission(context, "notification:use");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new NotificationQueryError();
    }

    const [activities, alerts, userActions] = await Promise.all([
      this.activities.project({
        tenantId: context.tenantId,
        take: 200,
      }),
      roleHasPermission(context.role, "alert:read")
        ? this.alerts.listOccurrences(context.tenantId, 100)
        : Promise.resolve([]),
      roleHasPermission(context.role, "action:prepare")
        ? this.state.listUserActionEvents(
            context.tenantId,
            context.userId,
            50,
          )
        : Promise.resolve([]),
    ]);

    const candidates = deduplicate([
      ...alerts.map(alertCandidate),
      ...activities.flatMap((event) => {
        const candidate = activityCandidate(context, event);
        return candidate ? [candidate] : [];
      }),
      ...userActions,
    ]);

    const readIds = await this.state.readIds(
      context.tenantId,
      context.userId,
      candidates.map((item) => item.id),
    );

    return {
      items: candidates.slice(0, limit).map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        description: item.description,
        createdAt: item.createdAt.toISOString(),
        sourceEvent: item.sourceEvent,
        sourceAuthority: item.sourceAuthority,
        href: item.href,
        productId: item.productId,
        severity: item.severity,
        acknowledged: item.acknowledged,
        read: readIds.has(item.id),
      })),
      unreadCount: candidates.filter((item) => !readIds.has(item.id)).length,
      totalCount: candidates.length,
      dataBoundary:
        "Inbox derivada somente de alertas e eventos governados existentes. O estado lida/não lida é pessoal por usuário; notificações não executam ações nem concedem novas permissões.",
    };
  }

  async markRead(
    context: TenantContext,
    notificationId: string,
  ): Promise<{ readonly notificationId: string; readonly status: "read" }> {
    requirePermission(context, "notification:use");
    const normalized = notificationId.trim();
    if (!NOTIFICATION_ID.test(normalized)) {
      throw new NotificationQueryError();
    }

    const visible = await this.inbox(context, 100);
    if (!visible.items.some((item) => item.id === normalized)) {
      throw new NotificationNotFoundError();
    }

    await this.state.markRead({
      tenantId: context.tenantId,
      userId: context.userId,
      notificationId: normalized,
      correlationId: context.correlationId,
    });

    return { notificationId: normalized, status: "read" };
  }
}
