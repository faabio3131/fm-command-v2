import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GrowthIntelligenceService } from "@/application/growth/growth-intelligence-service";
import { MetricService } from "@/application/metrics/metric-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export default async function GrowthPage() {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const overview = await new GrowthIntelligenceService(
    new MetricService(new PostgresMetricStore()),
    new PostgresProductRepository(),
  ).overview(context);

  return (
    <main className="dashboard-shell dashboard-shell-compact growth-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">F13 · Growth / Comercial</span>
          <h1>Growth governado</h1>
          <p>Leads e trials usam fatos autorizados. Conversão, CAC e atribuição não são inferidos sem contrato semântico.</p>
        </div>
        <Link href="/dashboard">Voltar</Link>
      </header>

      <section className="metric-grid">
        {overview.metrics.map(({ target, status, value }) => (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{target.displayName}</span>
            <strong>{status === "pending_semantics" ? "Semântica pendente" : value?.value ?? "Indisponível"}</strong>
            <small>{value ? `Fonte: ${value.sourceAuthority}` : status === "pending_semantics" ? "Regra ainda não aprovada" : "Fonte ainda não conectada"}</small>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Atribuição e funil</h2>
        <p>{overview.attribution.reason}</p>
        <p>{overview.funnel.reason}</p>
      </section>
    </main>
  );
}
