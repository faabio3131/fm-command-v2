"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslator } from "@/i18n/react/i18n-provider";
import type { MessageKey } from "@/i18n/translate";

type Budget = { enabled: boolean; currency: string; capMinor: number; reserveMinor: number; summary: string };
type Draft = { id: string; period: string; status: string; errorCode: string | null; subject: string; body: string; unverified: string[]; inputs: string[]; cost: { text: string; currency: string } | null; sentQueued: number | null };

export function AgentsPanel({ canWrite, canApprove, canBudget, budget, drafts }: { canWrite: boolean; canApprove: boolean; canBudget: boolean; budget: Budget | null; drafts: Draft[] }) {
  const { t } = useTranslator();
  const router = useRouter();
  const [message, setMessage] = useState<Record<string, string>>({});
  const say = (key: string, text: string) => setMessage((m) => ({ ...m, [key]: text }));
  const known = (prefix: string, code: string | null | undefined, fallback: string) => {
    const key = `${prefix}.${code}` as MessageKey;
    return code ? t(key) === key ? fallback : t(key) : fallback;
  };

  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/agents/budget", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: form.get("enabled") === "on", capMinor: Number(form.get("cap")), reserveMinor: Number(form.get("reserve")), currency: String(form.get("currency") ?? "").toUpperCase() }),
    });
    say("budget", response.ok ? t("agents.budget.saved") : t("agents.budget.error"));
    if (response.ok) router.refresh();
  }
  async function requestDraft() {
    const response = await fetch("/api/agents/drafts", { method: "POST" });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    say("request", response.ok ? t("agents.draft.requested") : known("agents.refused", data.error, t("agents.draft.actionError")));
    router.refresh();
  }
  async function approve(draft: Draft, form: HTMLFormElement) {
    const data = new FormData(form);
    const response = await fetch(`/api/agents/drafts/${draft.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: data.get("subject"), body: data.get("body") }) });
    const result = (await response.json().catch(() => ({}))) as { queued?: number };
    say(draft.id, response.ok ? t("agents.draft.sentTo", { count: result.queued ?? 0 }) : t("agents.draft.actionError"));
    router.refresh();
  }
  async function reject(draft: Draft) {
    const response = await fetch(`/api/agents/drafts/${draft.id}/reject`, { method: "POST" });
    if (!response.ok) say(draft.id, t("agents.draft.actionError"));
    router.refresh();
  }

  return (
    <>
      <section className="panel" aria-labelledby="agent-budget">
        <h2 id="agent-budget">{t("agents.budget.title")}</h2>
        {budget ? <p data-budget-summary>{budget.summary}</p> : <p>{t("agents.budget.none")}</p>}
        {canBudget ? (
          <form onSubmit={saveBudget} className="form-grid" key={budget ? `${budget.capMinor}-${budget.reserveMinor}-${budget.currency}-${budget.enabled}` : "none"}>
            <label><input type="checkbox" name="enabled" defaultChecked={budget?.enabled ?? false} /> {t("agents.budget.enabled")}</label>
            <label>{t("agents.budget.cap")}<input name="cap" type="number" min={0} step={1} required defaultValue={budget?.capMinor ?? 500} /></label>
            <label>{t("agents.budget.reserve")}<input name="reserve" type="number" min={0} step={1} required defaultValue={budget?.reserveMinor ?? 25} /></label>
            <label>{t("agents.budget.currency")}<input name="currency" required maxLength={3} minLength={3} defaultValue={budget?.currency ?? "USD"} /></label>
            <button type="submit">{t("agents.budget.save")}</button>
            <p role="note">{message.budget}</p>
          </form>
        ) : <p>{t("agents.budget.ownerOnly")}</p>}
      </section>

      <section className="panel" aria-labelledby="agent-drafts">
        <h2 id="agent-drafts">{t("agents.draft.title")}</h2>
        {canWrite ? <p><button type="button" onClick={requestDraft}>{t("agents.draft.request")}</button> <small role="status">{message.request}</small></p> : null}
        {drafts.length === 0 ? <p>{t("agents.draft.none")}</p> : drafts.map((d) => (
          <article key={d.id} data-draft={d.status} className="panel">
            <h3>{t("agents.draft.period", { period: d.period })} — {t(`agents.draft.status.${d.status}` as MessageKey)}</h3>
            {d.status === "failed" ? <p>{known("agents.error", d.errorCode, t("agents.draft.actionError"))}</p> : null}
            {d.cost ? <small>{t("agents.draft.cost", { cost: d.cost.text, currency: d.cost.currency })}</small> : null}
            {d.unverified.length > 0 ? <p role="alert">{t("agents.draft.unverified", { numbers: d.unverified.join(", ") })}</p> : null}
            {d.status === "ready" && canApprove ? (
              <form onSubmit={(e) => { e.preventDefault(); void approve(d, e.currentTarget); }} className="form-grid">
                <label>{t("agents.draft.subject")}<input name="subject" defaultValue={d.subject} required maxLength={150} /></label>
                <label>{t("agents.draft.body")}<textarea name="body" defaultValue={d.body} required rows={9} maxLength={6000} /></label>
                <button type="submit">{t("agents.draft.approve")}</button>
                <button type="button" onClick={() => reject(d)}>{t("agents.draft.reject")}</button>
              </form>
            ) : d.body ? <><strong>{d.subject}</strong><p style={{ whiteSpace: "pre-wrap" }}>{d.body}</p></> : null}
            {d.status === "sent" && d.sentQueued !== null ? <small>{t("agents.draft.sentTo", { count: d.sentQueued })}</small> : null}
            <small role="status">{message[d.id]}</small>
            <details><summary>{t("agents.draft.inputs")}</summary><ul>{d.inputs.map((l, i) => <li key={i}>{l}</li>)}</ul></details>
          </article>
        ))}
      </section>
    </>
  );
}
