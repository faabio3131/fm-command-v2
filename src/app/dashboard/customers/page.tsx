import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CustomerIntelligenceService } from "@/application/customer/customer-intelligence-service";
import { MetricService } from "@/application/metrics/metric-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export default async function CustomersPage() {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const overview = await new CustomerIntelligenceService(
    new MetricService(new PostgresMetricStore()),
    new PostgresProductRepository(),
  ).overview(context);

  return (
    <main className="dashboard-shell dashboard-shell-compact customers-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">F15 · Clientes, Uso e Suporte</span>
          <h1>Inteligência de uso e suporte</h1>
          <p>A superfície usa somente agregados governados. Nenhum score de risco ou experiência é inventado.</p>
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
        <h2>Sinais factuais disponíveis</h2>
        {overview.factualSignals.length ? (
          <ul>
            {overview.factualSignals.map((signal) => (
              <li key={signal.metricId}><strong>{signal.displayName}:</strong> {signal.value ?? "Indisponível"}</li>
            ))}
          </ul>
        ) : <p>Nenhum sinal factual disponível nas fontes autorizadas.</p>}
      </section>

      <section className="panel">
        <h2>Risco e adoção</h2>
        <p>{overview.customerRisk.reason}</p>
        <p>{overview.adoption.reason}</p>
        <p>{overview.privacy.note}</p>
      </section>
    </main>
  );
}
