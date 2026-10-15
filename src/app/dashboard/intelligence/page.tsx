import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ExecutiveAnalysisService } from "@/application/executive/executive-analysis-service";
import { MetricService } from "@/application/metrics/metric-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { CoreQueryForm } from "../core-query-form";

function formatValue(value: string | null, unit: string, currency?: string) {
  if (value === null) return "Indisponível";
  return unit === "currency" && currency ? `${value} ${currency}` : value;
}

export default async function IntelligencePage() {
  let context;
  try { context = await resolveTenantContext(await headers()); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const overview = await new ExecutiveAnalysisService(
    new MetricService(new PostgresMetricStore()),
    new PostgresProductRepository(),
  ).overview(context);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">F16 · Core Executivo Avançado</span>
          <h1>Inteligência executiva governada</h1>
          <p>Fatos, inferências, recomendações e previsões permanecem separados. Ausência de evidência nunca vira certeza.</p>
        </div>
        <Link href="/dashboard">Voltar</Link>
      </header>

      <section className="executive-section">
        <div className="section-heading">
          <div><span className="eyebrow">Evidence Pack</span><h2>Sinais multi-domínio</h2></div>
          <p>Correlação cognitiva usa somente métricas governadas e não implica causalidade.</p>
        </div>
        <div className="metric-grid">
          {overview.signals.map((signal) => (
            <article className="metric-card" key={signal.metricId}>
              <span className="metric-label">{signal.displayName}</span>
              <strong>{signal.value ? formatValue(signal.value.value, signal.value.unit, signal.value.currency) : "Indisponível"}</strong>
              <small>{signal.status === "available" ? "FATO · fonte governada" : "DADO INDISPONÍVEL"}</small>
              <small>
                Variação: {signal.variation.status === "available"
                  ? `${signal.variation.direction} · delta ${signal.variation.delta}`
                  : "evidência histórica insuficiente"}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="guardrail-grid" aria-label="Guardrails analíticos">
        <article><span className="eyebrow">Correlação</span><strong>{overview.correlation.status === "evidence_ready" ? "Evidência disponível" : "Evidência insuficiente"}</strong><p>{overview.correlation.note}</p></article>
        <article><span className="eyebrow">Anomalia</span><strong>Evidência insuficiente</strong><p>{overview.anomaly.reason}</p></article>
        <article><span className="eyebrow">Risco</span><strong>Evidência insuficiente</strong><p>{overview.risk.reason}</p></article>
        <article><span className="eyebrow">Previsão</span><strong>Evidência insuficiente</strong><p>{overview.forecast.reason}</p></article>
      </section>

      <CoreQueryForm />
    </main>
  );
}
