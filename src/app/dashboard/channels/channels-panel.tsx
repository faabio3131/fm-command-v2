"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslator } from "@/i18n/react/i18n-provider";
import { CHANNEL_KINDS, type ChannelKind } from "@/domain/channels/contracts";
import type { MessageKey } from "@/i18n/translate";

type Provider = { id: string; kind: ChannelKind; credential: "none" | "api_key"; simulated: boolean };
type Config = { kind: ChannelKind; providerId: string; sender: string; enabled: boolean; minSeverity: string; hasKey: boolean };
type Recipient = { id: string; kind: ChannelKind; address: string; label: string; enabled: boolean };
type Delivery = { id: string; kind: ChannelKind; recipient: string; status: string; errorCode: string | null; when: string };

const SEVERITIES = ["info", "warning", "critical"] as const;

export function ChannelsPanel({ canWrite, providers, configs, recipients, deliveries, locale }: {
  canWrite: boolean; providers: Provider[]; configs: Config[]; recipients: Recipient[]; deliveries: Delivery[]; locale: string;
}) {
  const { t } = useTranslator();
  const router = useRouter();
  const [message, setMessage] = useState<Record<string, string>>({});
  const say = (key: string, text: string) => setMessage((m) => ({ ...m, [key]: text }));

  async function call(url: string, method: string, body?: unknown): Promise<Response> {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return response;
  }

  async function saveConfig(kind: ChannelKind, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await call("/api/channels/config", "PUT", {
      kind, providerId: form.get("providerId"), sender: form.get("sender"), enabled: form.get("enabled") === "on",
      minSeverity: form.get("minSeverity"), apiKey: form.get("apiKey") || undefined,
    });
    say(`config-${kind}`, response.ok ? t("channels.saved") : t("channels.saveError"));
    if (response.ok) router.refresh();
  }

  async function addRecipient(kind: ChannelKind, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await call("/api/channels/recipients", "POST", { kind, address: form.get("address"), label: form.get("label") });
    say(`recipient-${kind}`, response.ok ? "" : t("channels.addError"));
    if (response.ok) { formElement.reset(); router.refresh(); }
  }

  async function sendTest(id: string) {
    const response = await call(`/api/channels/recipients/${id}/test`, "POST");
    const data = (await response.json().catch(() => ({}))) as { receipt?: { status: string } };
    const status = data.receipt?.status;
    say(`test-${id}`, t("channels.testResult", { status: status ? t(`channels.status.${status}` as MessageKey) : t("channels.saveError") }));
    router.refresh();
  }

  async function toggle(r: Recipient) { await call(`/api/channels/recipients/${r.id}`, "PATCH", { enabled: !r.enabled }); router.refresh(); }
  async function remove(r: Recipient) { await call(`/api/channels/recipients/${r.id}`, "DELETE"); router.refresh(); }

  return (
    <>
      {CHANNEL_KINDS.map((kind) => {
        const options = providers.filter((p) => p.kind === kind);
        const config = configs.find((c) => c.kind === kind);
        const list = recipients.filter((r) => r.kind === kind);
        const selected = options.find((p) => p.id === config?.providerId) ?? options[0];
        return (
          <section key={kind} className="panel" aria-labelledby={`channel-${kind}`} data-channel={kind}>
            <h2 id={`channel-${kind}`}>{t(`channels.kind.${kind}` as MessageKey)}</h2>
            {options.length === 0 ? <p>{t("channels.noProvider")}</p> : (
              <form onSubmit={(e) => saveConfig(kind, e)} className="form-grid">
                <label>{t("channels.provider")}
                  <select name="providerId" defaultValue={selected?.id} disabled={!canWrite}>
                    {options.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                  </select>
                </label>
                {options.some((p) => p.simulated) ? <small>{t("channels.simulatedNote")}</small> : null}
                <label>{t("channels.sender")}
                  <input name="sender" defaultValue={config?.sender ?? ""} disabled={!canWrite} required />
                </label>
                <label>{t("channels.minSeverity")}
                  <select name="minSeverity" defaultValue={config?.minSeverity ?? "warning"} disabled={!canWrite}>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{t(`channels.severity.${s}` as MessageKey)}</option>)}
                  </select>
                </label>
                {options.some((p) => p.credential === "api_key") ? (
                  <label>{t("channels.apiKey")}
                    <input name="apiKey" type="password" autoComplete="off" disabled={!canWrite} />
                    <small>{t("channels.apiKeyHint")}</small>
                  </label>
                ) : null}
                <label><input name="enabled" type="checkbox" defaultChecked={config?.enabled ?? false} disabled={!canWrite} /> {t("channels.enabled")}</label>
                {canWrite ? <button type="submit">{t("channels.save")}</button> : null}
                <p role="note">{message[`config-${kind}`]}</p>
              </form>
            )}
            <h3>{t("channels.recipients")}</h3>
            {list.length === 0 ? <p>{t("channels.recipients.none")}</p> : (
              <ul>
                {list.map((r) => (
                  <li key={r.id}>
                    <span>{r.address}{r.label ? ` — ${r.label}` : ""}</span>{" "}
                    {canWrite ? (
                      <>
                        <button type="button" onClick={() => sendTest(r.id)}>{t("channels.test")}</button>{" "}
                        <button type="button" onClick={() => toggle(r)}>{r.enabled ? t("channels.disable") : t("channels.enable")}</button>{" "}
                        <button type="button" onClick={() => remove(r)}>{t("channels.remove")}</button>
                      </>
                    ) : null}
                    <small>{message[`test-${r.id}`]}</small>
                  </li>
                ))}
              </ul>
            )}
            {canWrite ? (
              <form onSubmit={(e) => addRecipient(kind, e)} className="form-grid">
                <label>{t("channels.address")}<input name="address" required /></label>
                <label>{t("channels.label")}<input name="label" /></label>
                <button type="submit">{t("channels.add")}</button>
                <p role="note">{message[`recipient-${kind}`]}</p>
              </form>
            ) : null}
          </section>
        );
      })}
      <section className="panel" aria-labelledby="channel-receipts">
        <h2 id="channel-receipts">{t("channels.receipts")}</h2>
        {deliveries.length === 0 ? <p>{t("channels.receipts.none")}</p> : (
          <table>
            <thead><tr>
              <th>{t("channels.col.recipient")}</th><th>{t("channels.col.channel")}</th><th>{t("channels.col.status")}</th><th>{t("channels.col.when")}</th><th>{t("channels.col.error")}</th>
            </tr></thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td>{d.recipient}</td><td>{t(`channels.kind.${d.kind}` as MessageKey)}</td>
                  <td>{t(`channels.status.${d.status}` as MessageKey)}</td>
                  <td>{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(d.when))}</td>
                  <td>{d.errorCode ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
