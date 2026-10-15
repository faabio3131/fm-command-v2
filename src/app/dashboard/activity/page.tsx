import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildActivityFeedService } from "@/application/activity/activity-feed-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
  type ActivityFeedItem,
} from "@/domain/activity/contracts";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

const FILTERS: readonly {
  value: "all" | ActivityCategory;
  label: string;
}[] = [
  { value: "all", label: "Todos" },
  { value: "finance", label: "Financeiro" },
  { value: "commercial", label: "Comercial" },
  { value: "operations", label: "Operações" },
  { value: "system", label: "Sistema" },
  { value: "security", label: "Segurança" },
];

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function categoryLabel(category: ActivityCategory): string {
  return FILTERS.find((filter) => filter.value === category)?.label ?? category;
}

function amountLabel(item: ActivityFeedItem): string | null {
  if (!item.amount) return null;
  if (item.currency) {
    const numeric = Number(item.amount);
    if (Number.isFinite(numeric)) {
      try {
        return new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: item.currency,
        }).format(numeric);
      } catch {
        return `${item.amount} ${item.currency}`;
      }
    }
  }
  return item.unit ? `${item.amount} ${item.unit}` : item.amount;
}

function pageHref(
  category: ActivityCategory | undefined,
  page: number,
  productId?: string,
) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  if (productId) params.set("productId", productId);
  const query = params.toString();
  return query ? `/dashboard/activity?${query}` : "/dashboard/activity";
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    page?: string;
    productId?: string;
  }>;
}) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  if (!roleHasPermission(context.role, "audit:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const category =
    params.category && params.category !== "all"
      ? (params.category as ActivityCategory)
      : undefined;
  if (category && !ACTIVITY_CATEGORIES.includes(category)) {
    redirect("/dashboard/activity");
  }

  const page = params.page ? Number(params.page) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 25) {
    redirect("/dashboard/activity");
  }

  const productId = params.productId?.trim() || undefined;
  const feed = await buildActivityFeedService().page(context, {
    category,
    productId,
    page,
    pageSize: 20,
  });

  return (
    <main className="dashboard-shell dashboard-shell-compact">
      <header className="dashboard-header">
        <div>
          <span className="eyebrow">CME-04 · Activity Feed governado</span>
          <h1>Atividades recentes</h1>
          <p>
            Projeção somente leitura de eventos governados já existentes no
            Audit Ledger e nos canonical facts da organização ativa.
          </p>
        </div>
        <Link className="button" href="/dashboard">
          Voltar à Visão Geral
        </Link>
      </header>

      <section className="panel">
        <h2>Fronteira do feed</h2>
        <p>{feed.dataBoundary}</p>
        <p>{feed.windowNote}</p>
      </section>

      <nav className="panel" aria-label="Filtros do Activity Feed">
        <strong>Filtrar por categoria</strong>
        <div className="command-quick-actions">
          {FILTERS.map((filter) => {
            const active = filter.value === (category ?? "all");
            return (
              <Link
                className={active ? "button primary" : "button"}
                aria-current={active ? "page" : undefined}
                href={pageHref(
                  filter.value === "all" ? undefined : filter.value,
                  1,
                  productId,
                )}
                key={filter.value}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <section className="executive-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Unified Operational Activity Projection</span>
            <h2>Timeline tenant-scoped</h2>
          </div>
          <p>
            Eventos técnicos permanecem técnicos; o Command não os converte em
            fatos comerciais adicionais nem expõe payload/metadata brutos.
          </p>
        </div>

        <div className="product-grid">
          {feed.items.length ? (
            feed.items.map((item) => {
              const amount = amountLabel(item);
              return (
                <article className="product-card" key={item.id}>
                  <span className="eyebrow">
                    {categoryLabel(item.category)} · {dateLabel(item.occurredAt)}
                  </span>
                  <strong>{item.title}</strong>
                  <small>
                    Tipo: <code>{item.eventType}</code>
                  </small>
                  {amount ? <small>Valor: {amount}</small> : null}
                  {item.result ? <small>Resultado: {item.result}</small> : null}
                  {item.actorRef ? <small>Ator: {item.actorRef}</small> : null}
                  {item.productId ? (
                    <small>
                      Produto: <code>{item.productId}</code>
                    </small>
                  ) : null}
                  <small>
                    Autoridade: <code>{item.sourceAuthority}</code>
                  </small>
                  <small>
                    Proveniência:{" "}
                    {item.provenanceRefs.map((ref, index) => (
                      <span key={ref}>
                        {index ? " · " : ""}
                        <code>{ref}</code>
                      </span>
                    ))}
                  </small>
                  {item.correlationId ? (
                    <small>
                      Correlação: <code>{item.correlationId}</code>
                    </small>
                  ) : null}
                </article>
              );
            })
          ) : (
            <article className="product-card">
              <strong>Nenhuma atividade governada encontrada.</strong>
              <small>
                Ausência de eventos não é convertida em garantia de
                inatividade nem em dado fictício.
              </small>
            </article>
          )}
        </div>
      </section>

      <nav className="panel" aria-label="Paginação do Activity Feed">
        {feed.pagination.hasPrevious ? (
          <Link
            className="button"
            rel="prev"
            href={pageHref(category, page - 1, productId)}
          >
            Página anterior
          </Link>
        ) : null}
        <span>Página {page}</span>
        {feed.pagination.hasNext ? (
          <Link
            className="button"
            rel="next"
            href={pageHref(category, page + 1, productId)}
          >
            Próxima página
          </Link>
        ) : null}
      </nav>
    </main>
  );
}
