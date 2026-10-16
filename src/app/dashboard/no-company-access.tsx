import Link from "next/link";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { createTranslator } from "@/i18n/translate";
import { createMetricService } from "@/application/metrics/metric-composition";
import type { TenantContext } from "@/domain/security/tenant-context";

/** Quem só enxerga unidades específicas não vê dado do nível da empresa (ADR-019): a tela explica, em vez de falhar. */
export async function companyLevelDenied(context: TenantContext): Promise<boolean> {
  return !(await createMetricService().canReadCompanyLevel(context));
}

export async function NoCompanyAccess() {
  const { t } = createTranslator(await getRequestLocale());
  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <section className="panel" role="status">
        <strong>{t("dashboard.noCompanyAccess.title")}</strong>
        <p>{t("dashboard.noCompanyAccess.body")}</p>
        <Link href="/dashboard">{t("dashboard.noCompanyAccess.back")}</Link>
      </section>
    </main>
  );
}
