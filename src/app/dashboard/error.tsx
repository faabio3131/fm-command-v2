"use client";

import { useTranslator } from "@/i18n/react/i18n-provider";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useTranslator();
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <section className="panel" role="alert">
        <strong>{t("dashboard.error.title")}</strong>
        <p>{t("dashboard.error.body")}</p>
        <button className="button" type="button" onClick={() => reset()}>{t("dashboard.error.retry")}</button>
      </section>
    </main>
  );
}
