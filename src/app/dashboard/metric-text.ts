import type { MetricView } from "@/application/metrics/metric-service";
import type { Translate } from "@/i18n/translate";

/** Texto do período de uma métrica governada, no idioma da tela. */
export function temporalLabel(t: Translate, value?: MetricView | null): string {
  if (!value) return t("metric.temporal.unavailable");
  if (value.asOf) return t("metric.temporal.asOf", { value: value.asOf.toISOString() });
  if (value.periodStart || value.periodEnd) {
    return t("home.temporal.period", { start: value.periodStart?.toISOString() ?? "?", end: value.periodEnd?.toISOString() ?? "?" });
  }
  return t("home.temporal.none");
}
