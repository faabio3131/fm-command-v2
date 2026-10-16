import { getRequestLocale } from "@/application/i18n/request-locale";
import { createTranslator, type MessageKey } from "@/i18n/translate";

/** Tela de carregamento de uma rota do painel: título e texto vêm dos catálogos (`route.<tela>.loadingTitle/loadingText`). */
export async function RouteLoading({
  screen,
  compact = false,
}: {
  screen: "activity" | "settings" | "subscriptions" | "trials" | "notifications" | "search" | "units" | "channels" | "reports";
  compact?: boolean;
}) {
  const { t } = createTranslator(await getRequestLocale());
  return (
    <main className={compact ? "dashboard-shell dashboard-shell-compact" : "dashboard-shell"} aria-busy="true" aria-live="polite">
      <section className="panel">
        <strong>{t(`route.${screen}.loadingTitle` as MessageKey)}</strong>
        <p>{t(`route.${screen}.loadingText` as MessageKey)}</p>
      </section>
    </main>
  );
}
