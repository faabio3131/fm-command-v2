"use client";

import { useTranslator } from "@/i18n/react/i18n-provider";
import type { MessageKey } from "@/i18n/translate";

/** Tela de erro de uma rota do painel: título e texto vêm dos catálogos (`route.<tela>.errorTitle/errorText`). */
export function RouteError({
  screen,
  reset,
  compact = false,
}: {
  screen: "activity" | "settings" | "subscriptions" | "trials" | "notifications" | "search" | "units" | "channels";
  reset: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslator();
  return (
    <main className={compact ? "dashboard-shell dashboard-shell-compact" : "dashboard-shell"}>
      <section className="panel" role="alert">
        <strong>{t(`route.${screen}.errorTitle` as MessageKey)}</strong>
        <p>{t(`route.${screen}.errorText` as MessageKey)}</p>
        <button className="button" type="button" onClick={() => reset()}>
          {t("route.retry")}
        </button>
      </section>
    </main>
  );
}
