import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { MetricView } from "@/application/metrics/metric-service";
import { buildProductCockpitService } from "@/application/products/product-cockpit-composition";
import { ProductNotFoundError } from "@/application/products/product-registry-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { CoreQueryForm } from "../../core-query-form";
import {
  rotuloAtualidade,
  rotuloAutoridadeFonte,
  rotuloCategoriaProduto,
  rotuloDirecaoCrescimento,
  rotuloEstadoOcorrencia,
  rotuloMetrica,
  rotuloOperadorAlerta,
  rotuloQualidade,
  rotuloSeveridadeAlerta,
  rotuloStatusProduto,
} from "@/presentation/pt-br";

function displayValue(value: MetricView | null) {
  if (!value || value.value === null) return "Indisponível";
  if (value.unit === "currency" && value.currency) {
    const numeric = Number(value.value);
    if (Number.isFinite(numeric)) {
      try {
        return new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: value.currency,
        }).format(numeric);
      } catch {
        return `${value.value} ${value.currency}`;
      }
    }
  }
  return value.value;
}

function healthLabel(
  status: "operational" | "degraded" | "unavailable" | "unknown",
) {
  if (status === "operational") return "Operacional";
  if (status === "degraded") return "Degradado";
  if (status === "unavailable") return "Indisponível";
  return "Desconhecido";
}

function metricStateLabel(
  status: "available" | "unavailable" | "pending_semantics",
  value: MetricView | null,
) {
  if (status === "pending_semantics") return "Semântica pendente";
  return displayValue(value);
}

function sourceStatusLabel(
  status: "configured" | "healthy" | "degraded" | "unavailable",
) {
  if (status === "healthy") return "Saudável";
  if (status === "degraded") return "Degradada";
  if (status === "unavailable") return "Indisponível";
  return "Configurada";
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const { productId } = await params;
  let cockpit;
  try {
    cockpit = await buildProductCockpitService().overview(context, productId);
  } catch (error) {
    if (error instanceof ProductNotFoundError) notFound();
    throw error;
  }

  const hasHealth = cockpit.health.services.length > 0;
  const operatingResult = cockpit.finance.operatingResult;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">R5 · Product Cockpit</span>
          <h1>{cockpit.product.name}</h1>
          <p>
            Produto governado: <code>{cockpit.product.slug}</code> ·{" "}
            {rotuloStatusProduto(cockpit.product.status)}
          </p>
        </div>
        <div>
          {roleHasPermission(context.role, "billing:read") ? (
            <Link
              className="button"
              href={`/dashboard/products/${productId}/billing`}
            >
              Billing
            </Link>
          ) : null}
          {roleHasPermission(context.role, "receivable:read") ? (
            <Link
              className="button"
              href={`/dashboard/products/${productId}/receivables`}
            >
              Recebimentos
            </Link>
          ) : null}
          <Link className="button" href="/dashboard">
            Voltar
          </Link>
        </div>
      </header>

      <section className="metric-grid" aria-label="Resumo executivo do produto">
        <article className="metric-card">
          <span className="metric-label">Cobertura factual</span>
          <strong>
            {cockpit.coverage.available}/{cockpit.coverage.total}
          </strong>
          <small>
            {cockpit.coverage.pendingSemantics} semânticas pendentes ·{" "}
            {cockpit.coverage.unavailable} fontes indisponíveis
          </small>
        </article>

        <article className="metric-card">
          <span className="metric-label">Saúde operacional</span>
          <strong>
            {hasHealth
              ? `${cockpit.health.counts.operational}/${cockpit.health.services.length}`
              : "Indisponível"}
          </strong>
          <small>
            {hasHealth
              ? `${cockpit.health.counts.degraded} degradados · ${cockpit.health.counts.unavailable} indisponíveis · ${cockpit.health.counts.unknown} desconhecidos`
              : "Nenhum serviço governado registrado para este produto"}
          </small>
        </article>

        <article className="metric-card">
          <span className="metric-label">Resultado operacional</span>
          <strong>
            {operatingResult.status === "available"
              ? `${operatingResult.value} ${operatingResult.currency}`
              : "Indisponível"}
          </strong>
          <small>
            {operatingResult.status === "available"
              ? "Derivado deterministicamente de caixa e custos compatíveis"
              : "Exige caixa e custos governados na mesma moeda e período"}
          </small>
        </article>

        <article className="metric-card">
          <span className="metric-label">Alertas governados</span>
          <strong>{cockpit.alerts.counts.enabledRules} regras ativas</strong>
          <small>
            {cockpit.alerts.counts.recentActive} ocorrências ativas recentes ·{" "}
            {cockpit.alerts.counts.recentCriticalActive} críticas
          </small>
        </article>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">F11 · Inteligência por Produto</span>
            <h2>Matriz de cobertura factual</h2>
          </div>
          <p>
            O cockpit preserva a leitura canônica de cada métrica, inclusive
            categoria, atualidade, qualidade e proveniência.
          </p>
        </div>
        <div className="metric-grid">
          {cockpit.intelligence.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">
                {rotuloCategoriaProduto(target.category)} · {target.displayName}
              </span>
              <strong
                className={
                  status === "available"
                    ? "metric-value"
                    : "metric-value unavailable"
                }
              >
                {metricStateLabel(status, value)}
              </strong>
              <div className="metric-meta">
                <span>
                  {value
                    ? `Atualidade: ${rotuloAtualidade(value.freshnessStatus)}`
                    : "Atualidade indisponível"}
                </span>
                <span>
                  {value
                    ? `Qualidade: ${rotuloQualidade(value.qualityStatus)}`
                    : "Qualidade indisponível"}
                </span>
              </div>
              <small className="metric-provenance">
                {value
                  ? `Fonte: ${rotuloAutoridadeFonte(value.sourceAuthority)} · referências: ${value.provenanceRefs.length}`
                  : "Sem proveniência factual disponível"}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Comercial</span>
            <h2>Aquisição e crescimento</h2>
          </div>
          <p>
            Métricas são sempre resolvidas no escopo deste produto; conversão e
            atribuição permanecem fechadas quando a semântica não está aprovada.
          </p>
        </div>
        <div className="metric-grid">
          {cockpit.commercial.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{target.displayName}</span>
              <strong>{metricStateLabel(status, value)}</strong>
              <small>
                {value
                  ? `Fonte: ${rotuloAutoridadeFonte(value.sourceAuthority)} · ${rotuloAtualidade(value.freshnessStatus)}`
                  : status === "pending_semantics"
                    ? "Regra de negócio ainda não aprovada"
                    : "Fonte ainda não conectada"}
              </small>
            </article>
          ))}
        </div>
        <div className="panel">
          <p>{cockpit.commercial.funnel.reason}</p>
          <p>{cockpit.commercial.attribution.reason}</p>
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Financeiro</span>
            <h2>Receita, caixa e custos</h2>
          </div>
          <p>
            Billing, caixa, inadimplência e custos permanecem conceitos
            separados. O próximo bloco poderá adicionar controles de Billing sem
            alterar esta autoridade de leitura.
          </p>
        </div>
        <div className="metric-grid">
          {cockpit.finance.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{target.displayName}</span>
              <strong>{metricStateLabel(status, value)}</strong>
              <small>
                {value
                  ? `Fonte: ${rotuloAutoridadeFonte(value.sourceAuthority)} · qualidade: ${rotuloQualidade(value.qualityStatus)}`
                  : status === "pending_semantics"
                    ? "Semântica pendente"
                    : "Fonte ainda não conectada"}
              </small>
            </article>
          ))}
        </div>
        <div className="foundation-grid">
          <article>
            <h3>Unit economics</h3>
            <p>
              CAC, LTV, payback, ARPU e margem permanecem indisponíveis até
              numeradores, denominadores, população e período serem governados.
            </p>
          </article>
          <article>
            <h3>Billing & Recebimentos</h3>
            <p>
              Este cockpit não cria ledger, provider ou conta a receber paralela.
              Até os blocos canônicos de Billing e Receivables serem integrados,
              exibe somente métricas financeiras já governadas por produto.
            </p>
          </article>
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Clientes e uso</span>
            <h2>Engajamento e suporte</h2>
          </div>
          <p>
            A superfície expõe somente agregados governados e nunca PII ou fatos
            brutos.
          </p>
        </div>
        <div className="metric-grid">
          {cockpit.customer.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{target.displayName}</span>
              <strong>{metricStateLabel(status, value)}</strong>
              <small>
                {value
                  ? `Fonte: ${rotuloAutoridadeFonte(value.sourceAuthority)}`
                  : status === "pending_semantics"
                    ? "Semântica pendente"
                    : "Fonte ainda não conectada"}
              </small>
            </article>
          ))}
        </div>
        <div className="panel">
          <p>{cockpit.customer.customerRisk.reason}</p>
          <p>{cockpit.customer.adoption.reason}</p>
          <p>{cockpit.customer.privacy.note}</p>
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Operações</span>
            <h2>Saúde e sinais operacionais</h2>
          </div>
          <p>{cockpit.health.availability.reason}</p>
        </div>

        <div className="metric-grid">
          {cockpit.operations.metrics.map(({ target, status, value }) => (
            <article className="metric-card" key={target.metricId}>
              <span className="metric-label">{target.displayName}</span>
              <strong>{metricStateLabel(status, value)}</strong>
              <small>
                {value
                  ? `Fonte: ${rotuloAutoridadeFonte(value.sourceAuthority)}`
                  : status === "pending_semantics"
                    ? "Semântica pendente"
                    : "Fonte ainda não conectada"}
              </small>
            </article>
          ))}
        </div>

        <div className="foundation-grid">
          {cockpit.health.services.length ? (
            cockpit.health.services.map(
              ({ service, observation, effectiveStatus }) => (
                <article key={service.id}>
                  <strong>{service.name}</strong>
                  <span>
                    {service.environment} · {healthLabel(effectiveStatus)}
                  </span>
                  <p>
                    {observation
                      ? `Fonte: ${rotuloAutoridadeFonte(observation.sourceAuthority)} · evidências: ${observation.provenanceRefs.length}`
                      : "Sem observação governada"}
                  </p>
                </article>
              ),
            )
          ) : (
            <article>
              <strong>Saúde por serviço indisponível</strong>
              <p>Nenhum serviço monitorado foi registrado para este produto.</p>
            </article>
          )}
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Integrações</span>
            <h2>Fontes atribuídas ao produto</h2>
          </div>
          <p>{cockpit.integrations.scopeNote}</p>
        </div>
        <div className="foundation-grid">
          {cockpit.integrations.items.length ? (
            cockpit.integrations.items.map((source) => (
              <article key={source.id}>
                <strong>{source.name}</strong>
                <span>
                  {source.authoritativeDomain} · {sourceStatusLabel(source.status)}
                </span>
                <p>
                  Tipo: {source.sourceType} · sincronização: {source.syncMode} ·
                  mapping {source.mappingVersion}
                </p>
              </article>
            ))
          ) : (
            <article>
              <strong>Nenhuma integração product-scoped registrada</strong>
              <p>
                O cockpit não presume que uma fonte global do tenant pertença a
                este produto.
              </p>
            </article>
          )}
        </div>
        {cockpit.integrations.sharedTenantSourceCount > 0 ? (
          <p>
            Existem {cockpit.integrations.sharedTenantSourceCount} fonte(s)
            global(is) no tenant; elas não são atribuídas automaticamente a{" "}
            {cockpit.product.name}.
          </p>
        ) : null}
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Alertas</span>
            <h2>Atenção governada do produto</h2>
          </div>
          <p>{cockpit.alerts.windowNote}</p>
        </div>
        <div className="foundation-grid">
          {cockpit.alerts.occurrences.length ? (
            cockpit.alerts.occurrences.slice(0, 8).map((occurrence) => (
              <article key={occurrence.id}>
                <strong>{rotuloMetrica(occurrence.metricId)}</strong>
                <span>
                  {rotuloSeveridadeAlerta(occurrence.severity)} ·{" "}
                  {rotuloEstadoOcorrencia(occurrence.status)}
                </span>
                <p>
                  Valor observado: {occurrence.observedValue} · limite:{" "}
                  {rotuloOperadorAlerta(occurrence.operator)}{" "}
                  {occurrence.threshold}
                </p>
              </article>
            ))
          ) : (
            <article>
              <strong>Nenhuma ocorrência recente</strong>
              <p>
                Ausência de ocorrência nesta janela não é convertida em garantia
                de saúde ou uptime.
              </p>
            </article>
          )}
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Crescimento</span>
            <h2>Tendências governadas</h2>
          </div>
          <p>
            Apenas duas observações comparáveis do mesmo produto e métrica podem
            formar tendência.
          </p>
        </div>
        <div className="metric-grid">
          {cockpit.intelligence.growth.map((signal) => (
            <article className="metric-card" key={signal.metricId}>
              <span className="metric-label">
                {rotuloMetrica(signal.metricId)}
              </span>
              <strong
                className={
                  signal.status === "available"
                    ? "metric-value"
                    : "metric-value unavailable"
                }
              >
                {signal.status === "available"
                  ? rotuloDirecaoCrescimento(signal.direction)
                  : "Indisponível"}
              </strong>
              <small>Nenhum índice composto é produzido.</small>
            </article>
          ))}
        </div>
      </section>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Core contextual</span>
            <h2>Inteligência governada deste produto</h2>
          </div>
          <p>
            O escopo é validado server-side contra o Product Registry do tenant;
            o modelo não pode ampliar silenciosamente o produto selecionado.
          </p>
        </div>
        <CoreQueryForm
          productContext={{
            slug: cockpit.product.slug,
            name: cockpit.product.name,
          }}
        />
      </section>

      <section className="panel">
        <h2>Governança e proveniência</h2>
        <p>
          Este cockpit compõe autoridades existentes. Produto, métricas,
          financeiro, clientes, operações, saúde e alertas continuam sendo
          governados por seus próprios serviços canônicos.
        </p>
        <p>
          Sem fonte, semântica ou evidência suficiente, o estado permanece
          indisponível ou pendente — nunca zero presumido.
        </p>
        <p>Sem proveniência factual disponível, o valor permanece indisponível.</p>
      </section>
    </main>
  );
}
