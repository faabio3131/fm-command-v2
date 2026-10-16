"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDateTime } from "@/i18n/format";
import { useTranslator } from "@/i18n/react/i18n-provider";
import type { MessageKey } from "@/i18n/translate";

type AuthType = "api_key_pair" | "api_key" | "oauth2";

type CatalogView = {
  id: string;
  label: string;
  regions: string[];
  status: "ready" | "planned";
  authType: AuthType;
  variables: string[];
};

type SourceView = {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  hasSecretReference: boolean;
  configurable: boolean;
  label: string;
  authType?: AuthType;
  kind?: string;
  unitMap: Record<string, string>;
  unitRefField: string;
  lastAttemptAt?: string;
  lastAttemptStatus?: string;
  lastSuccessfulSyncAt?: string;
};

type Props = {
  catalog: CatalogView[];
  sources: SourceView[];
  units: { id: string; name: string }[];
  canWrite: boolean;
  defaultCurrency: string;
  timeZone: string;
};

const HEALTH: Record<string, MessageKey> = {
  healthy: "sources.health.healthy",
  degraded: "sources.health.degraded",
  unavailable: "sources.health.unavailable",
  configured: "sources.health.configured",
};
const SYNC: Record<string, MessageKey> = {
  completed: "sources.syncstatus.completed",
  running: "sources.syncstatus.running",
  failed: "sources.syncstatus.failed",
};
const AUTH_LABEL: Record<AuthType, MessageKey> = {
  api_key_pair: "sources.catalog.auth.api_key_pair",
  api_key: "sources.catalog.auth.api_key",
  oauth2: "sources.catalog.auth.oauth2",
};

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function SourceControlPanel({ catalog, sources, units, canWrite, defaultCurrency, timeZone }: Props) {
  const router = useRouter();
  const oauth = useSearchParams().get("oauth");
  const { t, locale } = useTranslator();
  const [creating, setCreating] = useState<CatalogView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, { code: string; unitId: string }[]>>({});

  const when = (value?: string) => (value ? formatDateTime(value, locale, timeZone) : t("sources.list.never"));

  function errorText(body: Record<string, unknown>): string {
    const code = typeof body.error === "string" ? body.error : "";
    if (code === "integration.source_config_invalid") {
      return t("sources.error.config", { field: typeof body.field === "string" ? body.field : "?" });
    }
    if (code === "integration.connector_not_ready") return t("sources.error.notReady");
    if (code === "integration.oauth_provider_not_configured") return t("sources.error.providerNotConfigured");
    if (code.startsWith("security.permission_denied")) return t("sources.error.permission");
    if (code === "integration.sync_failed") return t("sources.error.syncFailed");
    return t("sources.error.generic");
  }

  function note(id: string, text: string) {
    setNotes((current) => ({ ...current, [id]: text }));
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creating) return;
    const form = new FormData(event.currentTarget);
    const variables: Record<string, string> = {};
    for (const name of creating.variables) variables[name] = String(form.get(`var:${name}`) ?? "").trim();
    const currency = String(form.get("currency") ?? "").trim().toUpperCase();
    setBusy("create");
    setMessage(null);
    try {
      const response = await fetch("/api/sources/from-catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectorId: creating.id,
          name: String(form.get("name") ?? "").trim(),
          freshnessSeconds: Number(form.get("freshnessSeconds") ?? "300"),
          config: { ...(currency ? { currency } : {}), variables },
        }),
      });
      const body = await json(response);
      if (!response.ok) {
        setMessage(errorText(body));
        return;
      }
      setCreating(null);
      setMessage(t("sources.form.created"));
      router.refresh();
    } catch {
      setMessage(t("sources.error.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function saveAccess(event: FormEvent<HTMLFormElement>, source: SourceView) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload =
      source.authType === "api_key"
        ? { kind: "api_key", apiKey: String(form.get("apiKey") ?? "") }
        : { kind: "api_key_pair", appKey: String(form.get("appKey") ?? ""), appSecret: String(form.get("appSecret") ?? "") };
    setBusy(`access:${source.id}`);
    try {
      const response = await fetch(`/api/sources/${source.id}/credentials`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await json(response);
      if (!response.ok) {
        note(source.id, errorText(body));
        return;
      }
      formElement.reset();
      note(source.id, t("sources.access.saved"));
      router.refresh();
    } catch {
      note(source.id, t("sources.error.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function authorize(source: SourceView) {
    setBusy(`oauth:${source.id}`);
    try {
      const response = await fetch(`/api/sources/${source.id}/oauth/start`, { method: "POST" });
      const body = await json(response);
      if (!response.ok || typeof body.authorizeUrl !== "string") {
        note(source.id, errorText(body));
        return;
      }
      window.location.assign(body.authorizeUrl);
    } catch {
      note(source.id, t("sources.error.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function health(source: SourceView) {
    setBusy(`health:${source.id}`);
    try {
      const response = await fetch(`/api/sources/${source.id}/health`, { cache: "no-store" });
      const body = await json(response);
      if (!response.ok) {
        note(source.id, errorText(body));
        return;
      }
      const status = typeof body.status === "string" ? body.status : "unknown";
      note(source.id, t("sources.result.health", { status: t(HEALTH[status] ?? "sources.health.unknown") }));
      router.refresh();
    } catch {
      note(source.id, t("sources.error.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function sync(source: SourceView) {
    setBusy(`sync:${source.id}`);
    try {
      const response = await fetch(`/api/sources/${source.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const body = await json(response);
      if (!response.ok) {
        note(source.id, errorText(body));
        return;
      }
      const status = body.status;
      const ingested = typeof body.ingested === "number" ? body.ingested : 0;
      note(
        source.id,
        status === "duplicate"
          ? t("sources.result.syncDuplicate")
          : status === "in_progress"
            ? t("sources.result.syncRunning")
            : t("sources.result.syncDone", { count: ingested }),
      );
      router.refresh();
    } catch {
      note(source.id, t("sources.error.generic"));
    } finally {
      setBusy(null);
    }
  }

  function currentRows(source: SourceView) {
    return (
      rows[source.id] ??
      Object.entries(source.unitMap).map(([code, unitId]) => ({ code, unitId }))
    );
  }

  async function saveUnits(event: FormEvent<HTMLFormElement>, source: SourceView) {
    event.preventDefault();
    const field = String(new FormData(event.currentTarget).get("unitRefField") ?? "").trim();
    const unitMap: Record<string, string> = {};
    for (const row of currentRows(source)) {
      if (row.code.trim() && row.unitId) unitMap[row.code.trim()] = row.unitId;
    }
    setBusy(`units:${source.id}`);
    try {
      const response = await fetch(`/api/sources/${source.id}/config`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unitMap, ...(source.kind === "code" || !field ? {} : { unitRefField: field }) }),
      });
      const body = await json(response);
      if (!response.ok) {
        note(source.id, errorText(body));
        return;
      }
      note(source.id, t("sources.units.saved"));
      router.refresh();
    } catch {
      note(source.id, t("sources.error.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {oauth ? (
        <p role="status">{oauth === "connected" ? t("sources.oauth.connected") : t("sources.oauth.error")}</p>
      ) : null}

      <section className="executive-section" aria-labelledby="catalog-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("sources.catalog.eyebrow")}</span>
            <h2 id="catalog-title">{t("sources.catalog.title")}</h2>
          </div>
          <p>{t("sources.catalog.intro")}</p>
        </div>
        <div className="product-grid">
          {catalog.map((entry) => (
            <article className="product-card" key={entry.id}>
              <strong>{entry.label}</strong>
              <small>{t(entry.status === "ready" ? "sources.catalog.ready" : "sources.catalog.planned")}</small>
              <small>{t("sources.catalog.regions", { regions: entry.regions.join(", ") })}</small>
              <small>{t(AUTH_LABEL[entry.authType])}</small>
              {canWrite && entry.status === "ready" ? (
                <button className="button" type="button" onClick={() => { setCreating(entry); setMessage(null); }}>
                  {t("sources.catalog.connect")}
                </button>
              ) : null}
            </article>
          ))}
        </div>

        {creating ? (
          <form className="product-create-form" onSubmit={create}>
            <h3>{t("sources.form.title", { name: creating.label })}</h3>
            <label>
              {t("sources.form.name")}
              <input name="name" required maxLength={120} defaultValue={creating.label} autoComplete="off" />
            </label>
            <label>
              {t("sources.form.currency")}
              <input name="currency" maxLength={3} pattern="[A-Za-z]{3}" defaultValue={defaultCurrency} autoComplete="off" />
            </label>
            <label>
              {t("sources.form.freshness")}
              <input name="freshnessSeconds" type="number" min={30} max={86400} defaultValue={300} required />
            </label>
            {creating.variables.map((name) => (
              <label key={name}>
                {t("sources.form.variable", { name })}
                <input name={`var:${name}`} required maxLength={64} autoComplete="off" />
              </label>
            ))}
            <div>
              <button className="button" type="submit" disabled={busy === "create"}>
                {busy === "create" ? t("sources.form.submitting") : t("sources.form.submit")}
              </button>
              <button className="button" type="button" onClick={() => setCreating(null)}>
                {t("sources.form.cancel")}
              </button>
            </div>
          </form>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
      </section>

      <section className="executive-section" aria-labelledby="source-list-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t("sources.list.eyebrow")}</span>
            <h2 id="source-list-title">{t("sources.list.title")}</h2>
          </div>
          <p>{t("sources.list.intro")}</p>
        </div>

        {sources.length === 0 ? (
          <div className="empty-state">
            <strong>{t("sources.list.empty.title")}</strong>
            <p>{t("sources.list.empty.text")}</p>
          </div>
        ) : (
          <div className="product-grid">
            {sources.map((source) => (
              <article className="product-card" key={source.id}>
                <strong>{source.name}</strong>
                <small>{t("sources.list.type", { type: source.label })}</small>
                <small>{t(source.hasSecretReference ? "sources.list.access.present" : "sources.list.access.absent")}</small>
                <small>{t("sources.list.health", { status: t(HEALTH[source.status] ?? "sources.health.unknown") })}</small>
                <small>{t("sources.list.lastSync", { when: when(source.lastSuccessfulSyncAt) })}</small>
                <small>
                  {t("sources.list.lastAttempt", {
                    when: when(source.lastAttemptAt),
                    status: t(SYNC[source.lastAttemptStatus ?? ""] ?? "sources.syncstatus.never"),
                  })}
                </small>

                <div>
                  <button className="button" type="button" disabled={busy === `health:${source.id}`} onClick={() => void health(source)}>
                    {busy === `health:${source.id}` ? t("sources.action.testing") : t("sources.action.test")}
                  </button>
                  {canWrite ? (
                    <button className="button" type="button" disabled={busy === `sync:${source.id}`} onClick={() => void sync(source)}>
                      {busy === `sync:${source.id}` ? t("sources.action.syncing") : t("sources.action.sync")}
                    </button>
                  ) : null}
                </div>

                {canWrite && source.configurable ? (
                  <>
                    {source.authType === "oauth2" ? (
                      <button className="button" type="button" disabled={busy === `oauth:${source.id}`} onClick={() => void authorize(source)}>
                        {busy === `oauth:${source.id}` ? t("sources.access.authorizing") : t("sources.access.authorize")}
                      </button>
                    ) : (
                      <form onSubmit={(e) => void saveAccess(e, source)}>
                        <h4>{t("sources.access.title")}</h4>
                        {source.authType === "api_key" ? (
                          <label>
                            {t("sources.access.apiKey")}
                            <input name="apiKey" type="password" required maxLength={1000} autoComplete="off" />
                          </label>
                        ) : (
                          <>
                            <label>
                              {t("sources.access.appKey")}
                              <input name="appKey" type="password" required maxLength={200} autoComplete="off" />
                            </label>
                            <label>
                              {t("sources.access.appSecret")}
                              <input name="appSecret" type="password" required maxLength={500} autoComplete="off" />
                            </label>
                          </>
                        )}
                        <small>{t("sources.access.hint")}</small>
                        <button className="button" type="submit" disabled={busy === `access:${source.id}`}>
                          {busy === `access:${source.id}` ? t("sources.access.saving") : t("sources.access.save")}
                        </button>
                      </form>
                    )}

                    <form onSubmit={(e) => void saveUnits(e, source)}>
                      <h4>{t("sources.units.title")}</h4>
                      <small>{t("sources.units.intro")}</small>
                      {units.length === 0 ? <small>{t("sources.units.none")}</small> : null}
                      {source.kind === "code" ? null : (
                        <label>
                          {t("sources.units.field")}
                          <input name="unitRefField" defaultValue={source.unitRefField} maxLength={64} autoComplete="off" />
                        </label>
                      )}
                      {currentRows(source).map((row, index) => (
                        <div key={index}>
                          <input
                            aria-label={t("sources.units.code")}
                            placeholder={t("sources.units.code")}
                            value={row.code}
                            maxLength={64}
                            onChange={(e) =>
                              setRows((c) => ({ ...c, [source.id]: currentRows(source).map((r, i) => (i === index ? { ...r, code: e.target.value } : r)) }))
                            }
                          />
                          <select
                            aria-label={t("sources.units.unit")}
                            value={row.unitId}
                            onChange={(e) =>
                              setRows((c) => ({ ...c, [source.id]: currentRows(source).map((r, i) => (i === index ? { ...r, unitId: e.target.value } : r)) }))
                            }
                          >
                            <option value="">{t("sources.units.choose")}</option>
                            {units.map((u) => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                          <button
                            className="button"
                            type="button"
                            onClick={() => setRows((c) => ({ ...c, [source.id]: currentRows(source).filter((_, i) => i !== index) }))}
                          >
                            {t("sources.units.remove")}
                          </button>
                        </div>
                      ))}
                      <div>
                        <button
                          className="button"
                          type="button"
                          onClick={() => setRows((c) => ({ ...c, [source.id]: [...currentRows(source), { code: "", unitId: "" }] }))}
                        >
                          {t("sources.units.add")}
                        </button>
                        <button className="button" type="submit" disabled={busy === `units:${source.id}`}>
                          {busy === `units:${source.id}` ? t("sources.units.saving") : t("sources.units.save")}
                        </button>
                      </div>
                    </form>
                  </>
                ) : null}
                {notes[source.id] ? <small role="status">{notes[source.id]}</small> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
