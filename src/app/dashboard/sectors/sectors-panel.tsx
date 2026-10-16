"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslator } from "@/i18n/react/i18n-provider";

type Pack = {
  id: string; label: string; description: string; enabled: boolean; metrics: number;
  facts: { factType: string; description: string; money: boolean; statuses: { status: string; meaning: string }[] }[];
};

export function SectorsPanel({ canWrite, packs }: { canWrite: boolean; packs: Pack[] }) {
  const { t } = useTranslator();
  const router = useRouter();
  const [message, setMessage] = useState<Record<string, string>>({});

  async function setEnabled(pack: Pack, enabled: boolean) {
    await fetch(`/api/sectors/${pack.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
    router.refresh();
  }
  async function createReport(pack: Pack) {
    const response = await fetch(`/api/sectors/${pack.id}/report`, { method: "POST" });
    const data = (await response.json().catch(() => ({}))) as { created?: boolean };
    setMessage((m) => ({ ...m, [pack.id]: !response.ok ? t("sectors.report.error") : data.created ? t("sectors.report.created") : t("sectors.report.exists") }));
  }

  return (
    <>
      {packs.map((pack) => (
        <section className="panel" key={pack.id} data-pack={pack.id} aria-labelledby={`pack-${pack.id}`}>
          <h2 id={`pack-${pack.id}`}>{pack.label} — {pack.enabled ? t("sectors.on") : t("sectors.off")}</h2>
          <p>{pack.description} ({t("sectors.metricsCount", { count: pack.metrics })})</p>
          <p>
            {canWrite ? (
              <button type="button" onClick={() => setEnabled(pack, !pack.enabled)}>{pack.enabled ? t("sectors.disable") : t("sectors.enable")}</button>
            ) : null}{" "}
            {pack.enabled ? <Link href={`/dashboard/sectors/${pack.id}`}>{t("sectors.open")}</Link> : null}{" "}
            {pack.enabled && canWrite ? <button type="button" onClick={() => createReport(pack)}>{t("sectors.report.create")}</button> : null}
            {" "}<small role="status">{message[pack.id]}</small>
          </p>
          <h3>{t("sectors.contract")}</h3>
          <p>{t("sectors.contract.hint")}</p>
          <ul>
            {pack.facts.map((f) => (
              <li key={f.factType}>
                <code>{f.factType}</code> — {f.description} ({f.money ? t("sectors.contract.money") : t("sectors.contract.noMoney")})
                <ul>{f.statuses.map((s) => <li key={s.status}>{s.status}: {s.meaning}</li>)}</ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
