import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import { MetricService } from "@/application/metrics/metric-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

function displayValue(value: string | null, unit: string, currency?: string) {
  if (value === null) return "Indisponível";
  if (unit === "currency" && currency) return `${value} ${currency}`;
  return value;
}

export default async function FinancePage() {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const overview = await new FinancialIntelligenceService(
    new MetricService(new PostgresMetricStore()),
    new PostgresProductRepository(),
  ).overview(context);

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">F12 · Financeiro e Unit Economics</span>
          <h1>Inteligência financeira governada</h1>
          <p>Ausência de fonte permanece indisponível. Nenhum valor financeiro é estimado pelo Core.</p>
        </div>
        <Link href="/dashboard">Voltar</Link>
      </header>

      <section className="metric-grid">
        {overview.metrics.map(({ target, status, value }) => (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{target.displayName}</span>
            <strong>{status === "pending_semantics" ? "Semântica pendente" : value ? displayValue(value.value, value.unit, value.currency) : "Indisponível"}</strong>
            <small>{value ? `Fonte: ${value.sourceAuthority}` : "Fonte ainda não conectada"}</small>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Resultado operacional</h2>
        {overview.operatingResult.status === "available" ? (
          <p>
            <strong>{overview.operatingResult.value} {overview.operatingResult.currency}</strong>
            {" · "}
            {overview.operatingResult.direction === "profit" ? "resultado positivo" : overview.operatingResult.direction === "loss" ? "resultado negativo" : "equilíbrio"}
          </p>
        ) : (
          <p>Indisponível até existirem caixa recebido e custos governados, na mesma moeda e período compatível.</p>
        )}
      </section>

      <section className="panel">
        <h2>Unit economics</h2>
        <p>CAC, LTV, payback, ARPU e margem permanecem como semântica pendente até que numerador, denominador, população, período e política de cálculo sejam aprovados.</p>
      </section>
    </main>
  );
}
