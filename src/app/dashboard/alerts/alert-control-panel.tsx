"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useTranslator } from "@/i18n/react/i18n-provider";
import { createLabels } from "@/presentation/labels";

type Rule = { id: string; metricId: string; operator: string; threshold: string; severity: string; enabled: boolean; archived: boolean; productId?: string };
type Occurrence = { id: string; metricId: string; observedValue: string; threshold: string; severity: string; status: string };
type Product = { id: string; name: string };
type Metric = { metricId: string; displayName: string };

export function AlertControlPanel(props: {
  rules: readonly Rule[];
  occurrences: readonly Occurrence[];
  products: readonly Product[];
  metrics: readonly Metric[];
  canWrite: boolean;
  canPrepare: boolean;
}) {
  const { t, locale } = useTranslator();
  const labels = createLabels(locale);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as {
        error?: string;
        preview?: { riskLevel?: string; reason?: string };
        evaluation?: { status?: string; reason?: string };
        occurrence?: unknown;
        created?: boolean;
      };
      if (!response.ok) {
        if (payload.error === "alert.rule_duplicate") setMessage(t("alerts.err.duplicate"));
        else if (payload.error === "alert.rule_must_be_disabled") setMessage(t("alerts.err.mustDisable"));
        else setMessage(payload.error ?? t("alerts.err.generic"));
        return null;
      }
      if (payload.preview?.reason) setMessage(t("alerts.msg.preview", { risk: labels.riskLevel(payload.preview.riskLevel), reason: payload.preview.reason }));
      else if (payload.evaluation?.status === "unavailable") setMessage(t("alerts.msg.unavailable"));
      else if (payload.evaluation?.status === "clear") setMessage(t("alerts.msg.clear"));
      else if (payload.evaluation?.status === "incompatible") setMessage(t("alerts.msg.incompatible"));
      else setMessage(t("alerts.msg.ok"));
      return payload;
    } catch {
      setMessage(t("alerts.msg.failed"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await request("/api/alerts", {
      metricId: String(data.get("metricId") ?? ""),
      productId: String(data.get("productId") ?? "") || undefined,
      operator: String(data.get("operator") ?? ""),
      threshold: String(data.get("threshold") ?? ""),
      severity: String(data.get("severity") ?? ""),
      idempotencyKey: crypto.randomUUID(),
    });
    if (result) window.location.reload();
  }

  const operationalRules = props.rules.filter((rule) => !rule.archived);
  const archivedRules = props.rules.filter((rule) => rule.archived);

  return (
    <section className="alert-control" aria-labelledby="alert-control-title">
      <div className="section-heading">
        <div><span className="eyebrow">{t("alerts.panel.eyebrow")}</span><h2 id="alert-control-title">{t("alerts.panel.title")}</h2></div>
        <p>{t("alerts.panel.note")}</p>
      </div>

      {props.canWrite ? (
        <form className="alert-rule-form" onSubmit={createRule}>
          <label>{t("alerts.form.metric")}<select name="metricId">{props.metrics.map((metric) => <option value={metric.metricId} key={metric.metricId}>{metric.displayName}</option>)}</select></label>
          <label>{t("alerts.form.product")}<select name="productId"><option value="">{t("alerts.form.global")}</option>{props.products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label>
          <label>{t("alerts.form.operator")}<select name="operator" defaultValue="gt"><option value="gt">{labels.alertOperator("gt")} (&gt;)</option><option value="gte">{labels.alertOperator("gte")} (≥)</option><option value="lt">{labels.alertOperator("lt")} (&lt;)</option><option value="lte">{labels.alertOperator("lte")} (≤)</option><option value="eq">{labels.alertOperator("eq")} (=)</option></select></label>
          <label>{t("alerts.form.threshold")}<input name="threshold" inputMode="decimal" required placeholder={t("alerts.form.thresholdPlaceholder")} /></label>
          <label>{t("alerts.form.severity")}<select name="severity" defaultValue="warning"><option value="info">{labels.alertSeverity("info")}</option><option value="warning">{labels.alertSeverity("warning")}</option><option value="critical">{labels.alertSeverity("critical")}</option></select></label>
          <button className="button primary" disabled={busy} type="submit">{t("alerts.form.create")}</button>
        </form>
      ) : <p className="empty-state">{t("alerts.readOnly")}</p>}

      <div className="alert-list">
        {operationalRules.length ? operationalRules.map((rule) => (
          <article className="alert-item" key={rule.id}>
            <div>
              <strong>{labels.metric(rule.metricId)}</strong>
              <span>{t("alerts.rule.line", { operator: labels.alertOperator(rule.operator), threshold: rule.threshold, severity: labels.alertSeverity(rule.severity), state: labels.ruleState(rule.enabled, rule.archived) })}</span>
              <span>{t("alerts.techId", { id: rule.metricId })}</span>
            </div>
            {props.canWrite ? (
              <div className="alert-actions">
                {rule.enabled ? (
                  <>
                    <button className="button" disabled={busy} onClick={async () => {
                      const result = await request("/api/alerts/evaluate", { ruleId: rule.id });
                      if (result?.occurrence) window.location.reload();
                    }}>{t("alerts.rule.evaluate")}</button>
                    <button className="button" disabled={busy} onClick={async () => {
                      const result = await request("/api/alerts/disable", { ruleId: rule.id });
                      if (result) window.location.reload();
                    }}>{t("alerts.rule.disable")}</button>
                  </>
                ) : (
                  <button className="button" disabled={busy} onClick={async () => {
                    const result = await request("/api/alerts/archive", { ruleId: rule.id });
                    if (result) window.location.reload();
                  }}>{t("alerts.rule.archive")}</button>
                )}
              </div>
            ) : null}
          </article>
        )) : <div className="empty-state"><strong>{t("alerts.rule.noneTitle")}</strong><p>{t("alerts.rule.noneText")}</p></div>}
      </div>

      {archivedRules.length ? (
        <details className="alert-history">
          <summary>{t("alerts.archived", { count: archivedRules.length })}</summary>
          <div className="alert-list">
            {archivedRules.map((rule) => (
              <Link className="alert-item archive-link" href={`/dashboard/alerts/rules/${encodeURIComponent(rule.id)}`} key={rule.id}>
                <div>
                  <strong>{labels.metric(rule.metricId)}</strong>
                  <span>{t("alerts.rule.line", { operator: labels.alertOperator(rule.operator), threshold: rule.threshold, severity: labels.alertSeverity(rule.severity), state: labels.ruleState(rule.enabled, rule.archived) })}</span>
                  <span>{t("alerts.techId", { id: rule.metricId })}</span>
                </div>
                <span>{t("alerts.openArchive")}</span>
              </Link>
            ))}
          </div>
        </details>
      ) : null}

      <div className="alert-list">
        {props.occurrences.length ? props.occurrences.map((occurrence) => (
          <article className="alert-item" key={occurrence.id}>
            <div>
              <strong>{t("alerts.occ.title", { metric: labels.metric(occurrence.metricId), severity: labels.alertSeverity(occurrence.severity) })}</strong>
              <span>{t("alerts.occ.line", { value: occurrence.observedValue, threshold: occurrence.threshold, state: labels.occurrenceState(occurrence.status) })}</span>
              <span>{t("alerts.techId", { id: occurrence.metricId })}</span>
            </div>
            <div className="alert-actions">
              {props.canWrite && occurrence.status === "active" ? <button className="button" disabled={busy} onClick={async () => {
                const ok = await request("/api/alerts/acknowledge", { occurrenceId: occurrence.id });
                if (ok) window.location.reload();
              }}>{t("alerts.occ.ack")}</button> : null}
              {props.canPrepare ? <button className="button" disabled={busy} onClick={() => request("/api/alerts/actions/preview", {
                occurrenceId: occurrence.id,
                actionType: "investigate",
                idempotencyKey: crypto.randomUUID(),
              })}>{t("alerts.occ.prepare")}</button> : null}
            </div>
          </article>
        )) : null}
      </div>

      {message ? <p className="alert-feedback" role="status">{message}</p> : null}
    </section>
  );
}
