import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("CME-04 Activity Feed UI/API contract", () => {
  it("projeta Audit Ledger e canonical facts sem selecionar documentos brutos", () => {
    const repository = source(
      "src/infrastructure/activity/postgres-activity-repository.ts",
    );

    expect(repository).toContain("auditEvents.tenantId");
    expect(repository).toContain("canonicalFacts.tenantId");
    expect(repository).toContain("sourceDefinitions");
    expect(repository).toContain("provenanceRefs");
    expect(repository).toContain("->>'productId'");
    expect(repository).toContain("->>'amount'");
    expect(repository).toContain("->>'currency'");
    expect(repository).not.toContain("metadata: auditEvents.metadata");
    expect(repository).not.toContain("payload: canonicalFacts.payload");
    expect(repository).toContain(
      "orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))",
    );
    expect(repository).toContain(
      "orderBy(desc(canonicalFacts.sourceTimestamp), desc(canonicalFacts.id))",
    );
  });

  it("resolve tenant server-side e valida filtros/paginação na API", () => {
    const api = source("src/app/api/activity/route.ts");
    expect(api).toContain("resolveTenantContext(await headers())");
    expect(api).toContain('url.searchParams.get("category")');
    expect(api).toContain('url.searchParams.get("productId")');
    expect(api).toContain('"pageSize"');
    expect(api).toContain('"limit"');
    expect(api).toContain("activity.query_invalid");
    expect(api).not.toContain("x-tenant-id");
    expect(api).not.toContain("tenantId?:");
  });

  it("mantém navegação e visão geral protegidas por audit:read", () => {
    const navigation = source("src/domain/navigation/command-navigation.ts");
    const dashboard = source("src/app/dashboard/page.tsx");
    expect(navigation).toContain('href: "/dashboard/activity"');
    expect(navigation).toContain('permission: "audit:read"');
    expect(dashboard).toContain(
      'roleHasPermission(context.role, "audit:read")',
    );
    expect(dashboard).toContain("buildActivityFeedService().page");
    expect(dashboard).toContain("item.title");
  });

  it("possui filtros funcionais, paginação, empty/loading/error e provenance", () => {
    const page = source("src/app/dashboard/activity/page.tsx");
    const loading = source("src/app/dashboard/activity/loading.tsx");
    const error = source("src/app/dashboard/activity/error.tsx");

    for (const label of [
      "Todos",
      "Financeiro",
      "Comercial",
      "Operações",
      "Sistema",
      "Segurança",
    ]) {
      expect(page).toContain(label);
    }
    expect(page).toContain("pageHref");
    expect(page).toContain("Página anterior");
    expect(page).toContain("Próxima página");
    expect(page).toContain("Nenhuma atividade governada encontrada");
    expect(page).toContain("Proveniência");
    expect(page).toContain("sourceAuthority");
    expect(page).toContain(
      "não os converte em\n            fatos comerciais adicionais",
    );
    expect(loading).toContain('aria-busy="true"');
    expect(error).toContain('role="alert"');
  });
});
