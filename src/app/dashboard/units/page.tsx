import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BarChart } from "@/app/dashboard/charts/bar-chart";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { createUnitComparisonService } from "@/application/metrics/metric-composition";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { barWidthPercent, compareDecimals, parseDecimal } from "@/domain/core/decimal";
import { PERIOD_KINDS, parsePeriodKind } from "@/domain/metrics/period";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { RegionOutOfScopeError } from "@/domain/metrics/unit-comparison";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import type { Locale } from "@/i18n/locales";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";

function formatValue(value: string, unit: string, currency: string | undefined, locale: Locale): string {
  // Só exibição: o cálculo é feito em decimais exatos no domínio. Intl aceita o texto decimal sem passar por ponto flutuante.
  const amount = value as unknown as number;
  if (unit === "currency" && currency) return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  if (unit === "percent") return `${new Intl.NumberFormat(locale).format(amount)}%`;
  return new Intl.NumberFormat(locale).format(amount);
}

export default async function UnitsPage({ searchParams }: { searchParams: Promise<{ metric?: string; region?: string; period?: string }> }) {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const params = await searchParams;
  const visible = await buildSectorService().visibleMetricIds(context.tenantId);
  const selectable = METRIC_REGISTRY.filter((m) => visible.has(m.metricId));
  const definition = selectable.find((m) => m.metricId === params.metric) ?? selectable.find((m) => m.kind === "sum") ?? selectable[0];
  const metricName = labels.metricName(definition.metricId, definition.displayName);
  const service = createUnitComparisonService();
  const periodKind = parsePeriodKind(params.period);
  const periodApplies = definition.grain !== "as_of";

  let view = null;
  let regionDenied = false;
  try {
    view = await service.compare(context, { metricId: definition.metricId, regionId: params.region || undefined, periodKind });
  } catch (error) {
    if (!(error instanceof RegionOutOfScopeError)) throw error;
    regionDenied = true;
    view = await service.compare(context, { metricId: definition.metricId, periodKind });
  }

  const { comparison, regions } = view;
  const reporting = comparison.branches.filter((b) => b.value !== null);
  const max = reporting.map((b) => parseDecimal(b.value)).filter((v) => v !== null).sort((a, b) => compareDecimals(b, a))[0];
  const items = comparison.branches.map((b) => ({
    id: b.unitId,
    label: b.name,
    valueText: b.value === null ? null : formatValue(b.value, definition.unit, b.currency, locale),
    widthPercent: b.value === null || !max || comparison.rankingSuspended ? "0" : barWidthPercent(parseDecimal(b.value)!, max),
  }));
  const total = comparison.total;

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("units.eyebrow")}</span>
          <h1>{t("units.title")}</h1>
          <p>{t("units.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>

      <form className="panel units-filter" method="get" action="/dashboard/units">
        <label>{t("units.filter.metric")}
          <select name="metric" defaultValue={definition.metricId}>
            {selectable.map((m) => <option key={m.metricId} value={m.metricId}>{labels.metricName(m.metricId, m.displayName)}</option>)}
          </select>
        </label>
        <label>{t("units.filter.region")}
          <select name="region" defaultValue={comparison.regionId ?? ""}>
            <option value="">{t("units.filter.allRegions")}</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label>{t("units.filter.period")}
          <select name="period" defaultValue={periodKind}>
            {PERIOD_KINDS.map((k) => <option key={k} value={k}>{t(`units.period.${k}` as MessageKey)}</option>)}
          </select>
        </label>
        <button className="button primary" type="submit">{t("units.filter.apply")}</button>
      </form>

      {periodApplies ? null : <p className="empty-state" role="note">{t("units.period.asOfNote")}</p>}
      {regionDenied ? <p className="empty-state" role="status">{t("units.region.unavailable")}</p> : null}

      {comparison.branches.length === 0 ? (
        <section className="panel empty-state"><strong>{t("units.empty.title")}</strong><p>{t("units.empty.text")}</p></section>
      ) : (
        <>
          <section className="metric-grid" aria-label={t("units.total.title")}>
            <article className="metric-card">
              <span className="metric-label">{t("units.total.title")} · {metricName}</span>
              <strong>{total.status === "available" ? formatValue(total.value, definition.unit, total.currency, locale) : t("common.unavailable")}</strong>
              <small>{t("units.total.coverage", { reporting: total.reporting, expected: total.expected })}</small>
              {total.status === "available" && total.partial ? <small>{t("units.total.partial")}</small> : null}
              {total.status === "unavailable" ? <small>{t(`units.total.reason.${total.reason}` as MessageKey)}</small> : null}
            </article>
          </section>

          <section className="panel">
            <BarChart items={items} ariaLabel={t("units.chart.aria", { metric: metricName })} unavailableText={t("common.unavailable")} />
            {comparison.rankingSuspended ? <p>{t("units.rankingSuspended")}</p> : null}
          </section>

          <section className="panel">
            <table>
              <caption>{t("units.table.caption", { metric: metricName })}</caption>
              <thead><tr><th>{t("units.table.rank")}</th><th>{t("units.table.branch")}</th><th>{t("units.table.value")}</th><th>{t("units.table.share")}</th></tr></thead>
              <tbody>
                {comparison.branches.map((b) => (
                  <tr key={b.unitId}>
                    <td>{b.rank ?? "—"}</td>
                    <td>{b.name}</td>
                    <td>{b.value === null ? t("common.unavailable") : formatValue(b.value, definition.unit, b.currency, locale)}</td>
                    <td>{b.sharePercent === null ? "—" : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(b.sharePercent as unknown as number)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
