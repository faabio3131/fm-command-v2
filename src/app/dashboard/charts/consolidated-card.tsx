import type { CompanyConsolidation } from "@/application/metrics/unit-comparison-service";
import type { Locale } from "@/i18n/locales";
import { createTranslator } from "@/i18n/translate";
import { formatBranchValue } from "./branch-bars";

/**
 * Cartão de métrica cujo valor é a soma das filiais (a empresa não tem valor próprio). Mesma regra do painel inicial:
 * cobertura à vista, marca de total parcial, e só entra o que a pessoa enxerga. O valor próprio da empresa, quando existe, vence.
 */
export function ConsolidatedMetricCard({ metricName, unit, consolidation, locale }: { metricName: string; unit: string; consolidation: CompanyConsolidation; locale: Locale }) {
  const { t } = createTranslator(locale);
  const total = consolidation.total;
  if (total.status !== "available") return null;
  return (
    <article className="metric-card" data-consolidated="true">
      <span className="metric-label">{metricName}</span>
      <strong>{formatBranchValue(total.value, unit, total.currency, locale)}</strong>
      <small>
        {t(consolidation.fullCompany ? "home.metric.consolidated" : "home.metric.consolidatedScoped", { reporting: total.reporting, expected: total.expected })}
        {total.partial ? ` · ${t("home.metric.consolidatedPartial")}` : ""}
      </small>
    </article>
  );
}
