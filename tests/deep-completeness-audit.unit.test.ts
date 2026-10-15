import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("FM Command deep completeness audit — internal findings", () => {
  it("mantém a voz disponível para self sem abrir câmera/geolocalização", () => {
    const config = source("next.config.ts");
    expect(config).toContain('microphone=(self)');
    expect(config).toContain('camera=()');
    expect(config).toContain('geolocation=()');
    expect(config).not.toContain('microphone=()');
  });

  it("oferece Ctrl/Cmd+K global no shell", () => {
    const shell = source("src/app/dashboard/command-shell.tsx");
    expect(shell).toContain("event.ctrlKey || event.metaKey");
    expect(shell).toContain('event.key.toLowerCase() !== "k"');
    expect(shell).toContain('router.push("/dashboard/search")');
    expect(shell).toContain('document.getElementById("global-search-query")');
  });

  it("remove tenant ID técnico da UX principal", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    expect(dashboard).toContain('identity?.organizationName ?? "Organização ativa"');
    expect(dashboard).not.toContain("context.tenantId.slice");
    expect(dashboard).not.toContain("Identificador do tenant");
  });

  it("completa Trials sem promover semântica bloqueada", () => {
    const page = source("src/app/dashboard/trials/page.tsx");
    const loading = source("src/app/dashboard/trials/loading.tsx");
    const error = source("src/app/dashboard/trials/error.tsx");
    const metricService = source("src/application/metrics/metric-service.ts");
    expect(page).toContain("productService.get(context, requestedProductId)");
    expect(page).toContain('name="productId"');
    expect(page).toContain("Qualidade:");
    expect(page).toContain("Atualidade:");
    expect(page).toContain("Proveniência:");
    expect(page).toContain("Coorte");
    expect(page).toContain("Trials encerrados");
    expect(page).toContain("CoreQueryForm");
    expect(page).toContain('"trial.active.count"');
    expect(page).toContain('"trial.conversion.rate"');
    expect(page).toContain("Semântica pendente");
    expect(loading).toContain('aria-busy="true"');
    expect(error).toContain('role="alert"');
    expect(metricService).toContain("async overview(context: TenantContext, productId?: string)");
  });

  it("completa Assinaturas sem inventar novas assinaturas, MRR, ARR ou churn", () => {
    const page = source("src/app/dashboard/subscriptions/page.tsx");
    const loading = source("src/app/dashboard/subscriptions/loading.tsx");
    const error = source("src/app/dashboard/subscriptions/error.tsx");
    expect(page).toContain("productService.get(context, requestedProductId)");
    expect(page).toContain('name="productId"');
    expect(page).toContain("Novas assinaturas");
    expect(page).toContain("métrica canônica de novas assinaturas");
    expect(page).toContain("Qualidade:");
    expect(page).toContain("Atualidade:");
    expect(page).toContain("Proveniência:");
    expect(page).toContain("CoreQueryForm");
    expect(page).toContain('"subscription.logo_churn.rate"');
    expect(page).toContain('"revenue.mrr"');
    expect(page).toContain('"revenue.arr"');
    expect(page).toContain("Semântica pendente");
    expect(loading).toContain('aria-busy="true"');
    expect(error).toContain('role="alert"');
  });

  it("faz Configurações orquestrar a autoridade Better Auth real", () => {
    const page = source("src/app/dashboard/settings/page.tsx");
    const client = source("src/app/dashboard/settings/settings-identity-admin.tsx");
    const auth = source("src/infrastructure/auth/auth.ts");
    const access = source("src/infrastructure/auth/organization-access.ts");
    expect(page).toContain("SettingsIdentityAdmin");
    expect(page).toContain("canManageMembers");
    expect(page).toContain("Promise.resolve([])");
    expect(client).toContain("authClient.organization.update");
    expect(client).toContain("authClient.organization.inviteMember");
    expect(client).toContain("authClient.organization.updateMemberRole");
    expect(client).toContain("authClient.organization.removeMember");
    expect(auth).toContain("ac: organizationAc, roles: organizationRoles");
    expect(access).toContain("analyst: organizationAc.newRole");
    expect(access).toContain("viewer: organizationAc.newRole");
    expect(access).toMatch(/admin:[\s\S]*?organization: \[\]/);
  });

  it("contextualiza o Core sem criar nova autoridade factual", () => {
    const core = source("src/app/dashboard/core-query-form.tsx");
    expect(core).toContain("domainContext");
    expect(core).toContain("promptPrefix");
    expect(core).toContain("scopedQuestion");
    expect(core).toContain('fetch("/api/core/query"');
    expect(core).not.toContain('fetch("/api/metrics');
  });
});