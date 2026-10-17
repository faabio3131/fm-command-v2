import { buildSectorService } from "@/application/sectors/sector-composition";
import { PERIOD_KINDS, parsePeriodKind } from "@/domain/metrics/period";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import type { TenantContext } from "@/domain/security/tenant-context";
import type { Locale } from "@/i18n/locales";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { BranchInsights } from "./branch-insights";

/**
 * Seção de gráficos por filial de uma tela do painel: seletor de métrica e período + o bloco `BranchInsights`.
 * Cada tela passa as métricas dela (`metricIds`). Entram só as que somam ou contam, têm período e a empresa enxerga;
 * taxas e posições (a receber em aberto) não têm gráfico por filial. Sem nenhuma métrica elegível, a seção some.
 */
export async function BranchChartsSection({ context, action, metricIds, params, timeZone, locale, headingId, onlyCurrency = false }: {
  context: TenantContext;
  /** Rota da tela, para o formulário voltar a ela. */
  action: string;
  metricIds: readonly string[];
  params: { metric?: string; period?: string };
  timeZone: string;
  locale: Locale;
  headingId: string;
  onlyCurrency?: boolean;
}) {
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const visible = await buildSectorService().visibleMetricIds(context.tenantId).catch(() => new Set(metricIds));
  const chartable = METRIC_REGISTRY.filter((m) => metricIds.includes(m.metricId) && visible.has(m.metricId)
    && (m.kind === "sum" || m.kind === "count") && m.grain === "period" && (!onlyCurrency || m.unit === "currency"));
  const metric = chartable.find((m) => m.metricId === params.metric) ?? chartable[0];
  if (!metric) return null;
  const periodKind = parsePeriodKind(params.period);
  return (
    <>
      <form className="panel units-filter" method="get" action={action}>
        <label>{t("units.filter.metric")}
          <select name="metric" defaultValue={metric.metricId}>
            {chartable.map((m) => <option key={m.metricId} value={m.metricId}>{labels.metricName(m.metricId, m.displayName)}</option>)}
          </select>
        </label>
        <label>{t("units.filter.period")}
          <select name="period" defaultValue={periodKind}>
            {PERIOD_KINDS.map((k) => <option key={k} value={k}>{t(`units.period.${k}` as MessageKey)}</option>)}
          </select>
        </label>
        <button className="button primary" type="submit">{t("units.filter.apply")}</button>
      </form>
      <BranchInsights context={context} definition={metric} periodKind={periodKind} timeZone={timeZone} locale={locale} headingId={headingId} />
    </>
  );
}
