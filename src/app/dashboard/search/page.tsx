import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildGlobalSearchService } from "@/application/search/global-search-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  GlobalSearchRateLimitError,
  type GlobalSearchOverview,
  type GlobalSearchResultKind,
} from "@/domain/search/contracts";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { GlobalSearchForm } from "./global-search-form";

const RESULT_GROUPS: readonly {
  kind: GlobalSearchResultKind;
  label: string;
}[] = [
  { kind: "navigation", label: "Módulos e configurações" },
  { kind: "metric", label: "Métricas" },
  { kind: "product", label: "Produtos" },
  { kind: "source", label: "Fontes" },
  { kind: "alert_rule", label: "Regras de alerta" },
  { kind: "alert_occurrence", label: "Alertas e incidentes" },
  { kind: "activity", label: "Atividades" },
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (!roleHasPermission(context.role, "search:use")) {
    redirect("/dashboard");
  }

  const query = (await searchParams).q?.trim() ?? "";
  let overview: GlobalSearchOverview | null = null;
  let validationMessage = "";

  if (query) {
    if (query.length < 2 || query.length > 80) {
      validationMessage = "Digite entre 2 e 80 caracteres para buscar.";
    } else {
      try {
        overview = await buildGlobalSearchService().search(context, query, 50);
      } catch (error) {
        if (error instanceof GlobalSearchRateLimitError) {
          validationMessage =
            `Limite de buscas atingido. Tente novamente em até ${error.retryAfterSeconds} segundos.`;
        } else {
          throw error;
        }
      }
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">R9 · Busca global governada</span>
          <h1>Busca no FM Command</h1>
          <p>
            Localize módulos, métricas, produtos, fontes, alertas e atividades
            dentro das permissões da organização ativa.
          </p>
        </div>
        <Link className="button" href="/dashboard">
          Voltar à Visão Geral
        </Link>
      </header>

      <section className="panel">
        <GlobalSearchForm query={query} />
        <p>
          A busca é determinística, tenant-scoped e permission-aware. Ela não
          pesquisa segredos, config de integração, metadata bruto, identidade
          de atores nem PII operacional.
        </p>
      </section>

      {validationMessage ? (
        <section className="panel" role="alert">
          <strong>Busca temporariamente indisponível</strong>
          <p>{validationMessage}</p>
        </section>
      ) : null}

      {overview ? (
        <>
          <section className="metric-grid" aria-label="Cobertura da busca">
            <article className="metric-card">
              <span className="metric-label">Resultados</span>
              <strong>{overview.counts.returned}</strong>
              <small>{overview.counts.totalMatches} correspondências encontradas.</small>
            </article>
            <article className="metric-card">
              <span className="metric-label">Produtos / Fontes</span>
              <strong>
                {overview.counts.products} / {overview.counts.sources}
              </strong>
              <small>Somente recursos autorizados do tenant ativo.</small>
            </article>
            <article className="metric-card">
              <span className="metric-label">Métricas</span>
              <strong>{overview.counts.metrics}</strong>
              <small>Registry e targets executivos governados.</small>
            </article>
            <article className="metric-card">
              <span className="metric-label">Alertas / Atividades</span>
              <strong>
                {overview.counts.alertRules + overview.counts.alertOccurrences} /{" "}
                {overview.counts.activities}
              </strong>
              <small>Somente dados permitidos pelas permissões atuais.</small>
            </article>
          </section>

          <section className="executive-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Consulta</span>
                <h2>Resultados para “{overview.query}”</h2>
              </div>
              <p>{overview.coverageNote}</p>
            </div>

            {overview.items.length ? (
              RESULT_GROUPS.map((group) => {
                const items = overview.items.filter(
                  (item) => item.kind === group.kind,
                );
                if (!items.length) return null;
                return (
                  <section className="panel" key={group.kind}>
                    <h3>{group.label}</h3>
                    <div className="product-grid">
                      {items.map((item) => (
                        <Link
                          className="product-card"
                          href={item.href}
                          key={item.id}
                        >
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                          <small>
                            Autoridade: <code>{item.authority}</code>
                          </small>
                        </Link>
                      ))}
                    </div>
                  </section>
                );
              })
            ) : (
              <article className="product-card">
                <strong>Nenhum resultado governado encontrado.</strong>
                <small>
                  A ausência de correspondência não amplia o escopo nem consulta
                  fontes às quais o papel não tem acesso.
                </small>
              </article>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
