import { describe, expect, it } from "vitest";
import { readUiSource } from "./helpers/ui-source";
import { ptBR } from "../src/i18n/messages/pt-BR";

function source(path: string): string {
  return readUiSource(path);
}

describe("R9 Global Search UI/API contract", () => {
  it("resolve tenant server-side e lê somente query/limit da URL", () => {
    const api = source("src/app/api/search/route.ts");
    expect(api).toContain("resolveTenantContext(await headers())");
    expect(api).toContain('url.searchParams.get("q")');
    expect(api).not.toContain("x-tenant-id");
    expect(api).not.toContain("tenantId?:");
  });

  it("trata rate limit como 429 com Retry-After e usa guarda Postgres serializada", () => {
    const api = source("src/app/api/search/route.ts");
    const limiter = source(
      "src/infrastructure/search/postgres-search-rate-limiter.ts",
    );

    expect(api).toContain("GlobalSearchRateLimitError");
    expect(api).toContain("status: 429");
    expect(api).toContain('"Retry-After"');
    expect(limiter).toContain("pg_advisory_xact_lock");
    expect(limiter).toContain('"search.request.allowed"');
    expect(limiter).toContain("metadata: {}");
    expect(limiter).not.toContain("rawQuery");
  });

  it("declara a fronteira de dados e não promete busca de PII/segredos", () => {
    const page = source("src/app/dashboard/search/page.tsx");
    expect(page).toContain("tenant-scoped");
    expect(page).toContain("permission-aware");
    expect(page).toContain("não");
    expect(page).toContain("segredos");
    expect(page).toContain("metadata bruto");
    expect(page).toContain("PII");
  });

  it("possui formulário GET, Ctrl/Cmd+K, navegação nativa e rota própria no menu", () => {
    const form = source(
      "src/app/dashboard/search/global-search-form.tsx",
    );
    const navigation = source("src/domain/navigation/command-navigation.ts");

    expect(form).toContain('action="/dashboard/search"');
    expect(form).toContain('name="q"');
    expect(form).toContain('type="search"');
    expect(form).toContain("event.ctrlKey || event.metaKey");
    expect(form).toContain('event.key.toLowerCase() === "k"');
    expect(form).toContain('role="search"');
    expect(navigation).toContain('href: "/dashboard/search"');
    expect(navigation).toContain('permission: "search:use"');
  });

  it("agrupa resultados e possui estados de loading/error explícitos", () => {
    const page = source("src/app/dashboard/search/page.tsx");
    const loading = source("src/app/dashboard/search/loading.tsx");
    const error = source("src/app/dashboard/search/error.tsx");

    expect(page).toContain("RESULT_GROUPS");
    expect(page).toContain("search.group.${group}");
    expect(ptBR["search.group.navigation"]).toBe("Módulos e configurações");
    expect(ptBR["search.group.alert_occurrence"]).toBe("Alertas e incidentes");
    expect(ptBR["search.group.activity"]).toBe("Atividades");
    expect(loading).toContain('aria-busy="true"');
    expect(error).toContain('role="alert"');
    expect(error).toContain("Tentar novamente");
  });
});
