"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationItem } from "@/domain/notifications/contracts";
import { formatDateTime } from "@/i18n/format";
import { useTranslator } from "@/i18n/react/i18n-provider";
import type { MessageKey } from "@/i18n/translate";

const KIND_KEY: Record<NotificationItem["kind"], MessageKey> = {
  critical_alert: "notifications.kind.critical_alert",
  operational_warning: "notifications.kind.operational_warning",
  integration_failure: "notifications.kind.integration_failure",
  incident: "notifications.kind.incident",
  action_required: "notifications.kind.action_required",
  state_change: "notifications.kind.state_change",
  system_info: "notifications.kind.system_info",
};

export function NotificationList({
  items,
  timeZone,
}: {
  items: readonly NotificationItem[];
  timeZone: string;
}) {
  const { t, locale } = useTranslator();
  const kindLabel = (kind: NotificationItem["kind"]) => t(KIND_KEY[kind] ?? "notifications.kind.system_info");
  const dateLabel = (value: string) =>
    Number.isNaN(new Date(value).getTime()) ? t("common.dateUnavailable") : formatDateTime(value, locale, timeZone);
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function markRead(notificationId: string) {
    setBusyId(notificationId);
    setMessage("");
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        setMessage(payload.error ?? t("notifications.list.markFailed"));
        return;
      }
      router.refresh();
    } catch {
      setMessage(t("notifications.list.markFailed"));
    } finally {
      setBusyId(null);
    }
  }

  if (!items.length) {
    return (
      <div className="empty-state">
        <strong>{t("notifications.list.emptyTitle")}</strong>
        <p>{t("notifications.list.emptyText")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="alert-list">
        {items.map((item) => (
          <article className="alert-item" key={item.id}>
            <div>
              <span className="eyebrow">
                {kindLabel(item.kind)} · {dateLabel(item.createdAt)}
              </span>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
              <span>
                {t("notifications.list.state", {
                  read: item.read ? t("notifications.list.read") : t("notifications.list.unread"),
                  ack:
                    item.acknowledged !== undefined
                      ? " · " + (item.acknowledged ? t("notifications.list.acknowledged") : t("notifications.list.notAcknowledged"))
                      : "",
                })}
              </span>
              <span>
                {t("notifications.list.source", { authority: item.sourceAuthority, event: item.sourceEvent })}
              </span>
            </div>
            <div className="alert-actions">
              <Link className="button" href={item.href}>
                {t("notifications.list.openSource")}
              </Link>
              {!item.read ? (
                <button
                  className="button"
                  disabled={busyId === item.id}
                  onClick={() => markRead(item.id)}
                  type="button"
                >
                  {busyId === item.id ? t("notifications.list.registering") : t("notifications.list.markRead")}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {message ? <p role="status">{message}</p> : null}
    </>
  );
}
