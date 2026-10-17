import { BranchInsights } from "@/app/dashboard/charts/branch-insights";
import { companyLevelDenied, NoCompanyAccess } from "@/app/dashboard/no-company-access";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import { createMetricService } from "@/application/metrics/metric-composition";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { getCompanyTimeZone } from "@/application/i18n/request-timezone";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { FINANCIAL_METRIC_TARGETS } from "@/domain/finance/intelligence";
import { PERIOD_KINDS, parsePeriodKind } from "@/domain/metrics/period";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { createTranslator, type MessageKey, type Translate } from "@/i18n/translate";
import { createLabels } from "@/presentation/labels";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

function displayValue(t: Translate, value: string | null, unit: string, currency?: string) {
  if (value === null) return t("common.unavailable");
  if (unit === "currency" && currency) return `${value} ${currency}`;
  return value;
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ metric?: string; period?: string }> }) {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (await companyLevelDenied(context)) return <NoCompanyAccess />;

  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const labels = createLabels(locale);
  const params = await searchParams;
  const timeZone = await getCompanyTimeZone(context.tenantId);
  const periodKind = parsePeriodKind(params.period);
  // Métricas de dinheiro com período que a empresa enxerga: as financeiras da tela, só as que o motor já define.
  const visible = await buildSectorService().visibleMetricIds(context.tenantId).catch(() => new Set(FINANCIAL_METRIC_TARGETS.map((m) => m.metricId)));
  const chartable = METRIC_REGISTRY.filter((m) => m.kind === "sum" && m.grain === "period" && m.unit === "currency" && visible.has(m.metricId) && FINANCIAL_METRIC_TARGETS.some((f) => f.metricId === m.metricId));
  const chartMetric = chartable.find((m) => m.metricId === params.metric) ?? chartable[0];
  const overview = await new FinancialIntelligenceService(
    createMetricService(),
    new PostgresProductRepository(),
  ).overview(context);

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("finance.eyebrow")}</span>
          <h1>{t("finance.title")}</h1>
          <p>{t("finance.lead")}</p>
        </div>
        <Link href="/dashboard">{t("common.back")}</Link>
      </header>

      <section className="metric-grid">
        {overview.metrics.map(({ target, status, value }) => (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{labels.metricName(target.metricId, target.displayName)}</span>
            <strong>{status === "pending_semantics" ? t("common.pendingSemantics") : value ? displayValue(t, value.value, value.unit, value.currency) : t("common.unavailable")}</strong>
            <small>{value ? t("common.sourceLine", { source: value.sourceAuthority }) : t("common.sourceNotConnected")}</small>
          </article>
        ))}
      </section>

      {chartMetric ? (
        <>
          <form className="panel units-filter" method="get" action="/dashboard/finance">
            <label>{t("units.filter.metric")}
              <select name="metric" defaultValue={chartMetric.metricId}>
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
          <BranchInsights context={context} definition={chartMetric} periodKind={periodKind} timeZone={timeZone} locale={locale} headingId="finance-branch-title" />
        </>
      ) : null}

      <section className="panel">
        <h2>{t("finance.result")}</h2>
        {overview.operatingResult.status === "available" ? (
          <p>
            <strong>{overview.operatingResult.value} {overview.operatingResult.currency}</strong>
            {" · "}
            {overview.operatingResult.direction === "profit" ? t("finance.profit") : overview.operatingResult.direction === "loss" ? t("finance.loss") : t("finance.even")}
          </p>
        ) : (
          <p>{t("finance.resultNone")}</p>
        )}
      </section>

      <section className="panel">
        <h2>{t("finance.unit")}</h2>
        <p>{t("finance.unitText")}</p>
      </section>
    </main>
  );
}
