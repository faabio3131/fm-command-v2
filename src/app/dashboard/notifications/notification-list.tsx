"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationItem } from "@/domain/notifications/contracts";

function kindLabel(kind: NotificationItem["kind"]): string {
  if (kind === "critical_alert") return "Alerta crítico";
  if (kind === "operational_warning") return "Aviso operacional";
  if (kind === "integration_failure") return "Falha de integração";
  if (kind === "incident") return "Incidente";
  if (kind === "action_required") return "Requer atenção";
  if (kind === "state_change") return "Mudança de estado";
  return "Informação do sistema";
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function NotificationList({
  items,
}: {
  items: readonly NotificationItem[];
}) {
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
        setMessage(payload.error ?? "Não foi possível marcar como lida.");
        return;
      }
      router.refresh();
    } catch {
      setMessage("Não foi possível marcar como lida.");
    } finally {
      setBusyId(null);
    }
  }

  if (!items.length) {
    return (
      <div className="empty-state">
        <strong>Nenhuma notificação governada.</strong>
        <p>Eventos inexistentes não são transformados em notificações fictícias.</p>
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
                Estado: {item.read ? "Lida" : "Não lida"}
                {item.acknowledged !== undefined
                  ? " · " + (item.acknowledged ? "Reconhecida" : "Não reconhecida")
                  : ""}
              </span>
              <span>
                Fonte: <code>{item.sourceAuthority}</code> · evento{" "}
                <code>{item.sourceEvent}</code>
              </span>
            </div>
            <div className="alert-actions">
              <Link className="button" href={item.href}>
                Abrir origem
              </Link>
              {!item.read ? (
                <button
                  className="button"
                  disabled={busyId === item.id}
                  onClick={() => markRead(item.id)}
                  type="button"
                >
                  {busyId === item.id ? "Registrando…" : "Marcar como lida"}
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
