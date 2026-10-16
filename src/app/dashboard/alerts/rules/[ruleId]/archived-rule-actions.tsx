"use client";

import { useState } from "react";
import { useTranslator } from "@/i18n/react/i18n-provider";

export function ArchivedRuleActions(props: {
  metricId: string;
  productId?: string;
  operator: "gt" | "gte" | "lt" | "lte" | "eq";
  threshold: string;
  severity: "info" | "warning" | "critical";
}) {
  const { t } = useTranslator();
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
          setMessage(t("rule.action.duplicate"));
        } else {
          setMessage(payload.error ?? t("rule.action.failed"));
        }
        return;
      }
      setMessage(t("rule.action.created"));
    } catch {
      setMessage(t("rule.action.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="archive-actions">
      <button className="button primary" disabled={busy} onClick={recreate}>
        {t("rule.action.button")}
      </button>
      {message ? <p className="alert-feedback" role="status">{message}</p> : null}
    </div>
  );
}
