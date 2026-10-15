import type { ActivityRepository } from "@/domain/activity/contracts";
import type { AlertRepository } from "@/domain/alerts/contracts";
import {
  EXECUTIVE_METRIC_TARGETS,
  getMetricDefinition,
} from "@/domain/metrics/registry";
import type { ProductRepository } from "@/domain/products/contracts";
import {
  GlobalSearchQueryError,
  type GlobalSearchOverview,
  type GlobalSearchResult,
  type GlobalSearchResultKind,
  type SearchRateLimiter,
} from "@/domain/search/contracts";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";
import type { SourceRepository } from "@/domain/integration/contracts";
import {
  commandNavigationForRole,
  type CommandNavigationFeatures,
} from "@/domain/navigation/command-navigation";

type RankedResult = GlobalSearchResult & { readonly rank: number };

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function matchRank(query: string, values: readonly string[]): number | null {
  let best: number | null = null;
  for (const raw of values) {
    const value = normalize(raw);
    if (!value) continue;
    let rank: number | null = null;
    if (value === query) rank = 0;
    else if (value.startsWith(query)) rank = 1;
    else if (
      value
        .split(/[\s._:/-]+/)
        .some((token) => token.startsWith(query))
    ) rank = 2;
    else if (value.includes(query)) rank = 3;
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

function metricHref(metricId: string): string {
  if (metricId.startsWith("trial.")) return "/dashboard/trials";
  if (metricId.startsWith("subscription.")) return "/dashboard/subscriptions";
  if (
    metricId.startsWith("billing.") ||
    metricId.startsWith("revenue.") ||
    metricId.startsWith("receivable.") ||
    metricId.startsWith("cost.") ||
    metricId.startsWith("finance.")
  ) return "/dashboard/finance";
  if (metricId.startsWith("lead.")) return "/dashboard/growth";
  if (
    metricId.startsWith("incident.") ||
    metricId.startsWith("job.") ||
    metricId.startsWith("integration.") ||
    metricId.startsWith("service.")
  ) return "/dashboard/operations";
  if (
    metricId.startsWith("usage.") ||
    metricId.startsWith("support.")
  ) return "/dashboard/customers";
  return "/dashboard";
}

function countKind(
  items: readonly RankedResult[],
  kind: GlobalSearchResultKind,
): number {
  return items.filter((item) => item.kind === kind).length;
}

export class GlobalSearchService {
  constructor(
    private readonly products: Pick<ProductRepository, "list">,
    private readonly sources: Pick<SourceRepository, "list">,
    private readonly alerts: Pick<AlertRepository, "listRules" | "listOccurrences">,
    private readonly activities: Pick<ActivityRepository, "recent">,
    private readonly rateLimiter: SearchRateLimiter,
    private readonly integrationFeatures: (
      context: TenantContext,
    ) => Promise<CommandNavigationFeatures> = async () => ({}),
  ) {}

  async search(
    context: TenantContext,
    rawQuery: string,
    limit = 20,
  ): Promise<GlobalSearchOverview> {
    requirePermission(context, "search:use");

    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 80) {
      throw new GlobalSearchQueryError();
    }

    await this.rateLimiter.consume({
      tenantId: context.tenantId,
      userId: context.userId,
      correlationId: context.correlationId,
    });

    const normalizedQuery = normalize(query);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const ranked: RankedResult[] = [];
    const navigationFeatures = roleHasPermission(context.role, "integration:read")
      ? await this.integrationFeatures(context)
      : {};

    const push = (
      result: GlobalSearchResult,
      searchable: readonly string[],
    ) => {
      const rank = matchRank(normalizedQuery, searchable);
      if (rank !== null) ranked.push({ ...result, rank });
    };

    for (const item of commandNavigationForRole(context.role, navigationFeatures)) {
      push(
        {
          id: `navigation:${item.href}`,
          kind: "navigation",
          label: item.label,
          description: "Módulo autorizado do FM Command.",
          href: item.href,
          authority: "command_navigation",
        },
        [item.label, item.href],
      );
    }

    if (roleHasPermission(context.role, "metric:read")) {
      for (const target of EXECUTIVE_METRIC_TARGETS) {
        const definition = getMetricDefinition(target.metricId);
        push(
          {
            id: `metric:${target.metricId}`,
            kind: "metric",
            label: target.displayName,
            description:
              target.definitionStatus === "implemented"
                ? definition?.description ?? "Métrica governada do Registry."
                : "Semântica pendente; nenhum valor é presumido.",
            href: metricHref(target.metricId),
            authority:
              target.definitionStatus === "implemented"
                ? "metric_registry"
                : "executive_metric_target",
          },
          [
            target.displayName,
            target.metricId,
            definition?.description ?? "",
          ],
        );
      }
    }

    const [products, sources, alertRules, alertOccurrences, activities] =
      await Promise.all([
        roleHasPermission(context.role, "product:read")
          ? this.products.list(context.tenantId)
          : Promise.resolve([]),
        roleHasPermission(context.role, "source:read")
          ? this.sources.list(context.tenantId)
          : Promise.resolve([]),
        roleHasPermission(context.role, "alert:read")
          ? this.alerts.listRules(context.tenantId)
          : Promise.resolve([]),
        roleHasPermission(context.role, "alert:read")
          ? this.alerts.listOccurrences(context.tenantId, 100)
          : Promise.resolve([]),
        roleHasPermission(context.role, "audit:read")
          ? this.activities.recent(context.tenantId, 100)
          : Promise.resolve([]),
      ]);

    for (const product of products) {
      if (product.tenantId !== context.tenantId) continue;
      push(
        {
          id: `product:${product.id}`,
          kind: "product",
          label: product.name,
          description: `Produto ${product.status} · ${product.slug}`,
          href: `/dashboard/products/${encodeURIComponent(product.id)}`,
          authority: "product_registry",
        },
        [product.name, product.slug, product.id, product.status],
      );
    }

    for (const source of sources) {
      if (source.tenantId !== context.tenantId) continue;
      push(
        {
          id: `source:${source.id}`,
          kind: "source",
          label: source.name,
          description:
            `${source.sourceType} · ${source.authoritativeDomain} · ${source.status}`,
          href: "/dashboard/sources",
          authority: "source_registry",
        },
        [
          source.name,
          source.sourceType,
          source.authoritativeDomain,
          source.status,
          source.id,
        ],
      );
    }

    for (const rule of alertRules) {
      if (rule.tenantId !== context.tenantId || rule.archived) continue;
      const metric = getMetricDefinition(rule.metricId);
      push(
        {
          id: `alert_rule:${rule.id}`,
          kind: "alert_rule",
          label: metric?.displayName ?? rule.metricId,
          description:
            `${rule.severity} · ${rule.enabled ? "ativa" : "desativada"} · ${rule.operator} ${rule.threshold}`,
          href: `/dashboard/alerts/rules/${encodeURIComponent(rule.id)}`,
          authority: "alert_repository",
        },
        [
          rule.id,
          rule.metricId,
          metric?.displayName ?? "",
          rule.severity,
          rule.operator,
          rule.threshold,
        ],
      );
    }

    for (const occurrence of alertOccurrences) {
      if (occurrence.tenantId !== context.tenantId) continue;
      const metric = getMetricDefinition(occurrence.metricId);
      push(
        {
          id: `alert_occurrence:${occurrence.id}`,
          kind: "alert_occurrence",
          label: metric?.displayName ?? occurrence.metricId,
          description:
            `${occurrence.severity} · ${occurrence.status} · ${occurrence.occurredAt.toISOString()}`,
          href: "/dashboard/alerts",
          authority: "alert_repository",
        },
        [
          occurrence.metricId,
          metric?.displayName ?? "",
          occurrence.severity,
          occurrence.status,
          occurrence.ruleId,
        ],
      );
    }

    for (const activity of activities) {
      push(
        {
          id: `activity:${activity.id}`,
          kind: "activity",
          label: activity.action,
          description:
            `${activity.resourceType} · ${activity.result} · ${activity.occurredAt.toISOString()}`,
          href: "/dashboard/activity",
          authority: "audit_ledger",
        },
        [activity.action, activity.resourceType, activity.result],
      );
    }

    ranked.sort(
      (left, right) =>
        left.rank - right.rank ||
        left.label.localeCompare(right.label, "pt-BR") ||
        left.kind.localeCompare(right.kind),
    );

    const selected = ranked.slice(0, safeLimit);
    return {
      query,
      items: selected.map((item) => ({
        id: item.id,
        kind: item.kind,
        label: item.label,
        description: item.description,
        href: item.href,
        authority: item.authority,
      })),
      counts: {
        totalMatches: ranked.length,
        returned: selected.length,
        navigation: countKind(ranked, "navigation"),
        metrics: countKind(ranked, "metric"),
        products: countKind(ranked, "product"),
        sources: countKind(ranked, "source"),
        alertRules: countKind(ranked, "alert_rule"),
        alertOccurrences: countKind(ranked, "alert_occurrence"),
        activities: countKind(ranked, "activity"),
      },
      coverageNote:
        "Busca determinística sobre navegação/configurações autorizadas, Metric Registry, Product Registry, Source Registry, alertas/incidentes e atividades auditáveis permitidas do tenant. Segredos, config de integração, metadata bruto, ator e PII operacional não são indexados nesta superfície.",
    };
  }
}
