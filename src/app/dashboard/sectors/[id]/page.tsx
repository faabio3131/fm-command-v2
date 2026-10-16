import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { createUnitComparisonService } from "@/application/metrics/metric-composition";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { PACK_METRIC_DEFINITIONS, getSectorPack } from "@/domain/sectors/catalog";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import type { Locale } from "@/i18n/locales";
import { createTranslator } from "@/i18n/translate";

function formatValue(value: string, unit: string, currency: string | undefined, locale: Locale): string {
  const amount = value as unknown as number;
  if (unit === "currency" && currency) return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  return new Intl.NumberFormat(locale).format(amount);
}

export default async function SectorDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }
  const locale = await getRequestLocale();
  const { t } = createTranslator(locale);
  const pack = getSectorPack((await params).id);
  if (!pack) notFound();
  const sectors = buildSectorService();
  let enabled: boolean;
  try {
    await sectors.overview(context);
    enabled = await sectors.isEnabled(context.tenantId, pack.id);
  } catch (error) {
    if (error instanceof PermissionDeniedError) redirect("/dashboard");
    throw error;
  }
  const comparison = createUnitComparisonService();
  const sections = enabled
    ? await Promise.all(pack.sections.map(async (section) => ({
        title: section.title[locale],
        metrics: await Promise.all(section.metricIds.map(async (metricId) => {
          const definition = PACK_METRIC_DEFINITIONS.find((m) => m.metricId === metricId)!;
          const { comparison: c } = await comparison.compare(context, { metricId });
          return { id: metricId, name: pack.metrics.find((m) => m.id === metricId)!.name[locale], unit: definition.unit, total: c.total };
        })),
      })))
    : [];
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("sectors.eyebrow")}</span>
          <h1>{pack.label[locale]}</h1>
          <p>{pack.description[locale]}</p>
        </div>
        <Link href="/dashboard/sectors">{t("common.back")}</Link>
      </header>
      {!enabled ? (
        <section className="panel empty-state"><strong>{t("sectors.notEnabled")}</strong><p>{t("sectors.turnOnFirst")}</p></section>
      ) : sections.map((section) => (
        <section className="panel" key={section.title} aria-label={section.title}>
          <h2>{section.title}</h2>
          <div className="metric-grid">
            {section.metrics.map((m) => (
              <article className="metric-card" key={m.id} data-metric={m.id}>
                <span className="metric-label">{m.name}</span>
                <strong>{m.total.status === "available" ? formatValue(m.total.value, m.unit, m.total.currency, locale) : t("common.unavailable")}</strong>
                <small>{t("sectors.dashboard.branches", { reporting: m.total.reporting, expected: m.total.expected })}</small>
                <small><Link href={`/dashboard/units?metric=${m.id}`}>{t("sectors.dashboard.detail")}</Link></small>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
