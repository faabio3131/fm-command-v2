import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CoreQueryForm } from "@/app/dashboard/core-query-form";
import { MetricService, type MetricView } from "@/application/metrics/metric-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { rotuloAtualidade, rotuloAutoridadeFonte, rotuloQualidade } from "@/presentation/pt-br";

const SUBSCRIPTION_METRICS = new Set([
  "subscription.active.count",
  "subscription.cancelled.count",
  "subscription.logo_churn.rate",
  "revenue.mrr",
  "revenue.arr",
  "receivable.delinquent_amount",
]);

function temporalLabel(value?: MetricView | null): string {
  if (!value) return "Período indisponível";
  if (value.asOf) return `As of: ${value.asOf.toISOString()}`;
  if (value.periodStart || value.periodEnd) {
    return `Período: ${value.periodStart?.toISOString() ?? "?"} → ${value.periodEnd?.toISOString() ?? "?"}`;
  }
  return "Período não informado pela fonte";
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const productsRepository = new PostgresProductRepository();
  const productService = new ProductRegistryService(productsRepository);
  const products = await productService.list(context);
  const requestedProductId = (await searchParams).productId?.trim();
  let selectedProduct = undefined;

  if (requestedProductId) {
    try {
      selectedProduct = await productService.get(context, requestedProductId);
    } catch {
      redirect("/dashboard/subscriptions");
    }
  }

  const overview = await new MetricService(new PostgresMetricStore()).overview(
    context,
    selectedProduct?.id,
  );
  const metrics = overview.filter(({ target }) =>
    SUBSCRIPTION_METRICS.has(target.metricId),
  );
  const representativeValue = metrics.find(({ value }) => value)?.value;
  const authority = representativeValue?.sourceAuthority;

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">Assinaturas</span>
          <h1>Base recorrente</h1>
          <p>
            Assinaturas, cancelamentos, churn, MRR, ARR e inadimplência sem
            confundir faturamento, caixa ou receita recorrente.
          </p>
        </div>
        <Link href="/dashboard/finance">Abrir Financeiro</Link>
      </header>

      <section className="panel" aria-labelledby="subscriptions-scope-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Escopo governado</span>
            <h2 id="subscriptions-scope-title">Produto e período</h2>
          </div>
          <p>
            Escopo de produto é validado no servidor; provenance e período vêm
            somente dos valores governados disponíveis.
          </p>
        </div>
        <form action="/dashboard/subscriptions" method="get" className="command-quick-actions">
          <label htmlFor="subscriptions-product">Produto</label>
          <select
            id="subscriptions-product"
            name="productId"
            defaultValue={selectedProduct?.id ?? ""}
          >
            <option value="">Todos os produtos autorizados</option>
            {products.map((product) => (
              <option value={product.id} key={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <button className="button" type="submit">Aplicar escopo</button>
        </form>
        <div className="foundation-grid">
          <article>
            <strong>Produto</strong>
            <span>{selectedProduct?.name ?? "Consolidado autorizado"}</span>
          </article>
          <article>
            <strong>Período</strong>
            <span>{temporalLabel(representativeValue)}</span>
          </article>
          <article>
            <strong>Fonte</strong>
            <span>
              {authority
                ? rotuloAutoridadeFonte(authority)
                : "Indisponível — fonte ainda não conectada"}
            </span>
          </article>
        </div>
      </section>

      <section className="metric-grid" aria-label="Métricas de Assinaturas">
        <article className="metric-card">
          <span className="metric-label">Novas assinaturas</span>
          <strong>Indisponível</strong>
          <small>
            O contrato atual não possui métrica canônica de novas assinaturas no
            período. A ausência não é convertida em zero.
          </small>
        </article>
        {metrics.map(({ target, definition, value }) => (
          <article className="metric-card" key={target.metricId}>
            <span className="metric-label">{target.displayName}</span>
            <strong>
              {target.definitionStatus === "pending_semantics"
                ? "Semântica pendente"
                : value?.value ?? "Indisponível"}
            </strong>
            <div className="metric-meta">
              <span>
                {value
                  ? `Qualidade: ${rotuloQualidade(value.qualityStatus)}`
                  : definition
                    ? "Qualidade: indisponível"
                    : "Regra de negócio ainda não aprovada"}
              </span>
              <span>
                {value
                  ? `Atualidade: ${rotuloAtualidade(value.freshnessStatus)}`
                  : "Atualidade: indisponível"}
              </span>
              <span>{temporalLabel(value)}</span>
            </div>
            <small className="metric-provenance">
              {value
                ? `Fonte: ${rotuloAutoridadeFonte(value.sourceAuthority)} · Proveniência: ${value.provenanceRefs.join(" · ") || "não informada"}`
                : "Sem valor governado; nenhuma evidência é presumida."}
            </small>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Separação financeira</h2>
        <p>
          MRR e ARR só serão exibidos após contrato semântico aprovado;
          faturamento emitido e caixa recebido permanecem métricas distintas.
        </p>
      </section>

      <CoreQueryForm
        productContext={
          selectedProduct
            ? { slug: selectedProduct.slug, name: selectedProduct.name }
            : undefined
        }
        domainContext={{
          label: selectedProduct
            ? `Assinaturas · ${selectedProduct.name}`
            : "Assinaturas",
          promptPrefix:
            "Responda no contexto governado do módulo Assinaturas do FM Command. Preserve as autoridades do Metric Registry e não confunda MRR, ARR, faturamento, caixa ou inadimplência.",
        }}
      />
    </main>
  );
}
