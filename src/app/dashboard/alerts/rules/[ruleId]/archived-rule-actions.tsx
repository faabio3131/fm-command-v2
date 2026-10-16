"use client";

import { useState } from "react";

export function ArchivedRuleActions(props: {
  metricId: string;
  productId?: string;
  operator: "gt" | "gte" | "lt" | "lte" | "eq";
  threshold: string;
  severity: "info" | "warning" | "critical";
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function recreate() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          metricId: props.metricId,
          productId: props.productId,
          operator: props.operator,
          threshold: props.threshold,
          severity: props.severity,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        if (payload.error === "alert.rule_duplicate") {
          setMessage("Já existe uma regra ativa equivalente. O arquivo permanece preservado.");
        } else {
          setMessage(payload.error ?? "Não foi possível criar a nova regra.");
        }
        return;
      }
      setMessage("Nova regra criada a partir do arquivo. O registro arquivado foi preservado.");
    } catch {
      setMessage("Não foi possível criar a nova regra.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="archive-actions">
      <button className="button primary" disabled={busy} onClick={recreate}>
        Criar nova regra baseada nesta
      </button>
      {message ? <p className="alert-feedback" role="status">{message}</p> : null}
    </div>
  );
}
