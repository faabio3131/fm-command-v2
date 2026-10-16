import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { SourceRegistryService } from "@/application/integration/source-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { connectorCatalog, catalogEntry } from "@/infrastructure/connectors/catalog";
import { PostgresProfileRepository } from "@/infrastructure/i18n/postgres-profile-repository";
import {
  PostgresSourceRepository,
  PostgresSyncRepository,
} from "@/infrastructure/integration/postgres-repositories";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { createTranslator } from "@/i18n/translate";
import { SourceControlPanel } from "./source-control-panel";

export default async function SourcesPage() {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }
  if (!roleHasPermission(context.role, "source:read")) redirect("/dashboard");

  const { t } = createTranslator(await getRequestLocale());
  const sourceService = new SourceRegistryService(
    new PostgresSourceRepository(),
    new PostgresProductRepository(),
  );
  const syncRepository = new PostgresSyncRepository();
  const [sources, units, profile] = await Promise.all([
    sourceService.list(context),
    new PostgresUnitRepository().listUnits(context.tenantId),
    new PostgresProfileRepository().getOrgProfile(context.tenantId),
  ]);

  const views = await Promise.all(
    sources.map(async (source) => {
      const operational = await syncRepository.operationalState(context.tenantId, source.id);
      const entry = catalogEntry(source.sourceType);
      const cfg = source.config as Record<string, unknown>;
      const unitMap =
        cfg.unitMap && typeof cfg.unitMap === "object" && !Array.isArray(cfg.unitMap)
          ? Object.fromEntries(Object.entries(cfg.unitMap).filter(([, v]) => typeof v === "string")) as Record<string, string>
          : {};
      return {
        id: source.id,
        name: source.name,
        sourceType: source.sourceType,
        status: source.status,
        hasSecretReference: Boolean(source.secretRef),
        configurable: Boolean(entry),
        label: entry?.label ?? source.sourceType,
        authType: entry?.authType,
        kind: entry?.kind,
        unitMap,
        unitRefField: typeof cfg.unitRefField === "string" ? cfg.unitRefField : "",
        lastAttemptAt: operational.lastAttemptAt?.toISOString(),
        lastAttemptStatus: operational.lastAttemptStatus,
        lastSuccessfulSyncAt: operational.lastSuccessfulAt?.toISOString(),
      };
    }),
  );

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">{t("sources.eyebrow")}</span>
          <h1>{t("sources.title")}</h1>
          <p>{t("sources.intro")}</p>
        </div>
        <Link className="button" href="/dashboard">{t("sources.back")}</Link>
      </header>

      <section className="foundation-grid">
        {(["secrets", "isolation", "ingestion", "absence"] as const).map((k) => (
          <article key={k}>
            <strong>{t(`sources.principle.${k}.title`)}</strong>
            <span>{t(`sources.principle.${k}.text`)}</span>
          </article>
        ))}
      </section>

      <SourceControlPanel
        catalog={connectorCatalog().map((e) => ({
          id: e.id, label: e.label, regions: [...e.regions], status: e.status,
          authType: e.authType, variables: [...e.variables],
        }))}
        sources={views}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        canWrite={roleHasPermission(context.role, "source:write")}
        defaultCurrency={profile?.currency ?? ""}
        timeZone={profile?.timezone ?? "UTC"}
      />
    </main>
  );
}
