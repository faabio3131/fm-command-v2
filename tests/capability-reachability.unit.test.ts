import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { COMMAND_NAVIGATION } from "@/domain/navigation/command-navigation";

const ROOT = process.cwd();
const DASHBOARD_ROOT = resolve(ROOT, "src/app/dashboard");

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function walkPages(directory: string): string[] {
  const pages: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...walkPages(full));
    } else if (entry.isFile() && entry.name === "page.tsx") {
      pages.push(full);
    }
  }
  return pages;
}

function routeFromPage(pagePath: string): string {
  const rel = relative(DASHBOARD_ROOT, pagePath).replaceAll("\\", "/");
  if (rel === "page.tsx") return "/dashboard";
  return `/dashboard/${rel.replace(/\/page\.tsx$/, "")}`;
}

describe("FM Command capability reachability — zero órfãos", () => {
  it("todo destino da navegação global resolve para uma página Web real", () => {
    for (const item of COMMAND_NAVIGATION) {
      const route = item.href.split("#")[0];
      const relativeRoute = route === "/dashboard"
        ? "dashboard/page.tsx"
        : `${route.replace(/^\//, "")}/page.tsx`;
      expect(
        existsSync(resolve(ROOT, "src/app", relativeRoute)),
        `rota de navegação sem página: ${item.href}`,
      ).toBe(true);
    }
  });

  it("classifica toda página humana do dashboard como navegação global ou subrota alcançável", () => {
    const navigationRoutes = new Set(
      COMMAND_NAVIGATION.map((item) => item.href.split("#")[0]),
    );
    const reachableChildRoutes = new Set([
      "/dashboard/products/[productId]",
      "/dashboard/products/[productId]/billing",
      "/dashboard/products/[productId]/receivables",
      "/dashboard/alerts/rules/[ruleId]",
      "/dashboard/settings/platform-integrations",
    ]);

    const routes = walkPages(DASHBOARD_ROOT).map(routeFromPage).sort();
    const unclassified = routes.filter(
      (route) => !navigationRoutes.has(route) && !reachableChildRoutes.has(route),
    );

    expect(unclassified).toEqual([]);
  });

  it("mantém entry points explícitos para todas as subrotas humanas", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    const product = source("src/app/dashboard/products/[productId]/page.tsx");
    const alertControl = source("src/app/dashboard/alerts/alert-control-panel.tsx");
    const settings = source("src/app/dashboard/settings/page.tsx");

    expect(dashboard).toContain("/dashboard/products/${product.id}");
    expect(product).toContain("/dashboard/products/${productId}/billing");
    expect(product).toContain("/dashboard/products/${productId}/receivables");
    expect(alertControl).toContain(
      "/dashboard/alerts/rules/${encodeURIComponent(rule.id)}",
    );
    expect(settings).toContain("/dashboard/settings/platform-integrations");
  });

  it("preserva autenticação/tenant no layout e RBAC server-side nas rotas sensíveis", () => {
    const layout = source("src/app/dashboard/layout.tsx");
    const billing = source("src/app/dashboard/products/[productId]/billing/page.tsx");
    const receivables = source("src/app/dashboard/products/[productId]/receivables/page.tsx");
    const sources = source("src/app/dashboard/sources/page.tsx");
    const search = source("src/app/dashboard/search/page.tsx");
    const notifications = source("src/app/dashboard/notifications/page.tsx");
    const kordena = source("src/application/integration/kordena-commercial-control-service.ts");

    expect(layout).toContain("resolveTenantContext(await headers())");
    expect(billing).toContain('roleHasPermission(context.role, "billing:read")');
    expect(receivables).toContain('roleHasPermission(context.role, "receivable:read")');
    expect(sources).toContain('roleHasPermission(context.role, "source:read")');
    expect(search).toContain('roleHasPermission(context.role, "search:use")');
    expect(notifications).toContain('roleHasPermission(context.role, "notification:use")');
    expect(kordena).toContain('requirePermission(context, "commercial:read")');
    expect(kordena).toContain('requirePermission(context, "commercial:write")');
  });
});
