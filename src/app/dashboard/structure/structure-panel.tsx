"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslator } from "@/i18n/react/i18n-provider";
import type { MessageKey } from "@/i18n/translate";

type Unit = { id: string; parentId: string | null; kind: "company" | "region" | "branch"; name: string };
type Member = { userId: string; name: string; email: string; role: string };
type Grant = { userId: string; unitId: string };

export function StructurePanel({ units, members, grants }: { units: Unit[]; members: Member[]; grants: Grant[] }) {
  const { t } = useTranslator();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [checked, setChecked] = useState<Record<string, Set<string>>>(() => {
    const out: Record<string, Set<string>> = {};
    for (const g of grants) (out[g.userId] ??= new Set()).add(g.unitId);
    return out;
  });

  const company = units.find((u) => u.kind === "company") ?? null;
  const ordered = useMemo(() => {
    const children = new Map<string | null, Unit[]>();
    for (const u of units) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u]);
    const out: { unit: Unit; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const u of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) { out.push({ unit: u, depth }); walk(u.id, depth + 1); }
    };
    walk(null, 0);
    return out;
  }, [units]);
  const parents = units.filter((u) => u.kind !== "branch");

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.ok) { setMessage(t("structure.saved")); router.refresh(); return true; }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    const key = `structure.error.${data.error ?? ""}` as MessageKey;
    const known = data.error ? t(key) : "";
    setMessage(known && known !== key ? known : t("structure.error.generic"));
    return false;
  }

  async function submitCompany(form: FormData) { await call("/api/units", "POST", { kind: "company", name: String(form.get("name") ?? "") }); }
  async function submitAdd(form: FormData) {
    await call("/api/units", "POST", {
      kind: form.get("kind"), parentId: form.get("parentId") || null, name: String(form.get("name") ?? ""),
      countryCode: String(form.get("country") ?? "").toUpperCase() || undefined, currency: String(form.get("currency") ?? "").toUpperCase() || undefined,
      timezone: String(form.get("timezone") ?? "") || undefined,
    });
  }
  async function submitRename(unit: Unit, form: FormData) { await call(`/api/units/${unit.id}`, "PATCH", { name: String(form.get("name") ?? "") }); }
  async function submitMove(unit: Unit, form: FormData) { await call(`/api/units/${unit.id}`, "PATCH", { parentId: String(form.get("parentId") ?? "") }); }
  async function remove(unit: Unit) { if (window.confirm(t("structure.confirmRemove"))) await call(`/api/units/${unit.id}`, "DELETE"); }
  function toggle(userId: string, unitId: string) {
    setChecked((c) => { const next = new Set(c[userId] ?? []); if (next.has(unitId)) next.delete(unitId); else next.add(unitId); return { ...c, [userId]: next }; });
  }
  async function saveAccess(userId: string) { await call("/api/units/grants", "PUT", { userId, unitIds: [...(checked[userId] ?? [])] }); }

  if (!company) {
    return (
      <section className="panel" aria-labelledby="structure-empty">
        <h2 id="structure-empty">{t("structure.empty")}</h2>
        <form action={submitCompany}>
          <label>{t("structure.company.name")} <input name="name" required maxLength={120} /></label>{" "}
          <button type="submit">{t("structure.company.create")}</button>
        </form>
        <small role="status">{message}</small>
      </section>
    );
  }

  return (
    <>
      <section className="panel" aria-labelledby="structure-tree">
        <h2 id="structure-tree">{t("structure.title")}</h2>
        <ul data-testid="unit-tree">
          {ordered.map(({ unit, depth }) => (
            <li key={unit.id} data-unit={unit.name} style={{ marginLeft: depth * 20 }}>
              <strong>{unit.name}</strong> <small>({t(`structure.kind.${unit.kind}` as MessageKey)})</small>
              <details>
                <summary>{t("structure.rename")} / {t("structure.move")} / {t("structure.remove")}</summary>
                <form action={(f) => submitRename(unit, f)}>
                  <input name="name" defaultValue={unit.name} required maxLength={120} aria-label={t("structure.rename")} />{" "}
                  <button type="submit">{t("structure.rename")}</button>
                </form>
                {unit.kind !== "company" ? (
                  <form action={(f) => submitMove(unit, f)}>
                    <select name="parentId" defaultValue={unit.parentId ?? ""} aria-label={t("structure.move")}>
                      {parents.filter((p) => p.id !== unit.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>{" "}
                    <button type="submit">{t("structure.move")}</button>
                  </form>
                ) : null}
                {unit.kind !== "company" ? <button type="button" onClick={() => remove(unit)}>{t("structure.remove")}</button> : null}
              </details>
            </li>
          ))}
        </ul>
        <h3>{t("structure.add")}</h3>
        <form action={submitAdd} data-testid="add-unit">
          <label>{t("structure.add.name")} <input name="name" required maxLength={120} /></label>{" "}
          <label>{t("structure.add.kind")}{" "}
            <select name="kind"><option value="branch">{t("structure.kind.branch")}</option><option value="region">{t("structure.kind.region")}</option></select>
          </label>{" "}
          <label>{t("structure.add.parent")}{" "}
            <select name="parentId">{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>{" "}
          <label>{t("structure.add.country")} <input name="country" maxLength={2} size={3} /></label>{" "}
          <label>{t("structure.add.currency")} <input name="currency" maxLength={3} size={4} /></label>{" "}
          <label>{t("structure.add.timezone")} <input name="timezone" placeholder="America/Sao_Paulo" /></label>{" "}
          <button type="submit">{t("structure.add")}</button>
        </form>
        <small role="status">{message}</small>
      </section>

      <section className="panel" aria-labelledby="structure-access">
        <h2 id="structure-access">{t("structure.access.title")}</h2>
        <p>{t("structure.access.lead")}</p>
        {members.map((m) => {
          const sees = m.role === "owner" || m.role === "admin";
          return (
            <fieldset key={m.userId} data-member={m.email}>
              <legend>{m.name} — {m.email} ({m.role})</legend>
              {sees ? <p>{t("structure.access.all")}</p> : (
                <>
                  {ordered.map(({ unit, depth }) => (
                    <label key={unit.id} style={{ display: "block", marginLeft: depth * 20 }}>
                      <input type="checkbox" checked={checked[m.userId]?.has(unit.id) ?? false} onChange={() => toggle(m.userId, unit.id)} /> {unit.name}
                    </label>
                  ))}
                  <button type="button" onClick={() => saveAccess(m.userId)}>{t("structure.save")}</button>
                </>
              )}
            </fieldset>
          );
        })}
      </section>
    </>
  );
}
