"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslator } from "@/i18n/react/i18n-provider";
import type { MessageKey } from "@/i18n/translate";

type Metric = { id: string; name: string };
type Report = { id: string; name: string; frequency: "daily" | "weekly" | "monthly"; hour: number; weekday: number; dayOfMonth: number; enabled: boolean; metricCount: number; lastRunAt: string | null };

export function ReportsPanel({ canWrite, locale, metrics, reports }: { canWrite: boolean; locale: string; metrics: Metric[]; reports: Report[] }) {
  const { t } = useTranslator();
  const router = useRouter();
  const [frequency, setFrequency] = useState<Report["frequency"]>("daily");
  const [message, setMessage] = useState<Record<string, string>>({});
  const [exportIds, setExportIds] = useState<string[]>([]);
  const say = (key: string, text: string) => setMessage((m) => ({ ...m, [key]: text }));

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch("/api/reports", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"), metricIds: form.getAll("metric"), frequency, hour: Number(form.get("hour")),
        weekday: Number(form.get("weekday") ?? 1), dayOfMonth: Number(form.get("dayOfMonth") ?? 1),
      }),
    });
    say("create", response.ok ? "" : response.status === 409 ? t("reports.limitError") : t("reports.createError"));
    if (response.ok) { formElement.reset(); setFrequency("daily"); router.refresh(); }
  }
  async function sendNow(id: string) {
    const response = await fetch(`/api/reports/${id}/send`, { method: "POST" });
    const data = (await response.json().catch(() => ({}))) as { queued?: number };
    say(`send-${id}`, response.ok ? t("reports.sentNow", { count: data.queued ?? 0 }) : t("reports.createError"));
    router.refresh();
  }
  async function toggle(r: Report) {
    await fetch(`/api/reports/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !r.enabled }) });
    router.refresh();
  }
  async function remove(r: Report) { await fetch(`/api/reports/${r.id}`, { method: "DELETE" }); router.refresh(); }

  const scheduleText = (r: Report) =>
    r.frequency === "daily" ? t("reports.schedule.daily", { hour: r.hour })
    : r.frequency === "weekly" ? t("reports.schedule.weekly", { weekday: t(`reports.weekday.${r.weekday}` as MessageKey), hour: r.hour })
    : t("reports.schedule.monthly", { day: r.dayOfMonth, hour: r.hour });
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

  return (
    <>
      <section className="panel" aria-labelledby="reports-list">
        <h2 id="reports-list">{t("reports.title")}</h2>
        {reports.length === 0 ? <p>{t("reports.none")}</p> : (
          <ul>
            {reports.map((r) => (
              <li key={r.id} data-report={r.name}>
                <strong>{r.name}</strong> — {scheduleText(r)} — {r.lastRunAt ? t("reports.lastRun", { when: when(r.lastRunAt) }) : t("reports.never")}{" "}
                {canWrite ? (
                  <>
                    <button type="button" onClick={() => sendNow(r.id)}>{t("reports.sendNow")}</button>{" "}
                    <button type="button" onClick={() => toggle(r)}>{r.enabled ? t("reports.disable") : t("reports.enable")}</button>{" "}
                    <button type="button" onClick={() => remove(r)}>{t("reports.remove")}</button>
                  </>
                ) : null}
                <small>{message[`send-${r.id}`]}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canWrite ? (
        <section className="panel" aria-labelledby="reports-new">
          <h2 id="reports-new">{t("reports.new")}</h2>
          <form onSubmit={create} className="form-grid">
            <label>{t("reports.name")}<input name="name" required maxLength={80} /></label>
            <fieldset>
              <legend>{t("reports.metrics")}</legend>
              {metrics.map((m) => <label key={m.id}><input type="checkbox" name="metric" value={m.id} /> {m.name}</label>)}
            </fieldset>
            <label>{t("reports.frequency")}
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as Report["frequency"])}>
                <option value="daily">{t("reports.freq.daily")}</option>
                <option value="weekly">{t("reports.freq.weekly")}</option>
                <option value="monthly">{t("reports.freq.monthly")}</option>
              </select>
            </label>
            <label>{t("reports.hour")}<input name="hour" type="number" min={0} max={23} defaultValue={8} required /></label>
            {frequency === "weekly" ? (
              <label>{t("reports.weekday")}
                <select name="weekday" defaultValue="1">
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{t(`reports.weekday.${d}` as MessageKey)}</option>)}
                </select>
              </label>
            ) : null}
            {frequency === "monthly" ? <label>{t("reports.dayOfMonth")}<input name="dayOfMonth" type="number" min={1} max={28} defaultValue={1} required /></label> : null}
            <button type="submit">{t("reports.create")}</button>
            <p role="note">{message.create}</p>
          </form>
        </section>
      ) : null}
      <section className="panel" aria-labelledby="reports-export">
        <h2 id="reports-export">{t("reports.export")}</h2>
        <p>{t("reports.exportHint")}</p>
        <fieldset>
          <legend>{t("reports.metrics")}</legend>
          {metrics.map((m) => (
            <label key={m.id}>
              <input type="checkbox" checked={exportIds.includes(m.id)} onChange={(e) => setExportIds((ids) => (e.target.checked ? [...ids, m.id] : ids.filter((i) => i !== m.id)))} data-export={m.id} /> {m.name}
            </label>
          ))}
        </fieldset>
        <a href={exportIds.length > 0 ? `/api/reports/export?metrics=${exportIds.join(",")}` : undefined} aria-disabled={exportIds.length === 0} download>{t("reports.exportButton")}</a>
      </section>
    </>
  );
}
