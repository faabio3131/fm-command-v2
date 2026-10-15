import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("CME-07 header identity UI contract", () => {
  it("carrega identidade real e deployment governado no layout", () => {
    const layout = source("src/app/dashboard/layout.tsx");
    expect(layout).toContain("loadDashboardIdentity(context)");
    expect(layout).toContain("readDeploymentIdentity()");
    expect(layout).toContain("deploymentEnvironmentLabel");
    expect(layout).toContain("identity={identity}");
    expect(layout).toContain("environmentLabel={environmentLabel}");
  });

  it("mostra nome, papel traduzido, avatar/iniciais e organização sem tenant técnico", () => {
    const shell = source("src/app/dashboard/command-shell.tsx");
    expect(shell).toContain("rotuloPapelFmcc(role)");
    expect(shell).toContain("identity?.name");
    expect(shell).toContain("identity?.initials");
    expect(shell).toContain("identity?.imageUrl");
    expect(shell).toContain("identity?.organizationName");
    expect(shell).not.toContain("tenantId");
    expect(shell).not.toContain("Sessão protegida");
  });

  it("preserva logout, notificações e estado de ambiente", () => {
    const shell = source("src/app/dashboard/command-shell.tsx");
    expect(shell).toContain("<SignOutButton />");
    expect(shell).toContain("Central de Notificações");
    expect(shell).toContain("environmentLabel");
    expect(shell).toContain('aria-label={"Ambiente: " + environmentLabel}');
  });

  it("mantém identidade e menus funcionais também no mobile", () => {
    const css = source("src/app/globals.css");
    expect(css).toContain(".command-notification-menu,.command-user-menu{position:relative}");
    expect(css).toContain("@media(max-width:900px)");
    expect(css).toContain(".command-user-menu>.command-topbar-badge");
    expect(css).toContain(".command-environment-badge{display:none}");
    expect(css).toContain("display:inline-flex");
    expect(css).toContain(".command-user-avatar");
    expect(css).toContain("max-height:min(70vh,480px)");
    expect(css).toContain("position:fixed;");
    expect(css).toContain("width:min(340px,calc(100vw - 24px))");

    const shell = source("src/app/dashboard/command-shell.tsx");
    expect(shell).toContain("<p>Ambiente: {environmentLabel}</p>");
  });

  it("não exibe role técnica em Configurações", () => {
    const settings = source("src/app/dashboard/settings/page.tsx");
    expect(settings).toContain("rotuloPapelFmcc(context.role)");
    expect(settings).not.toContain("<strong>{context.role}</strong>");
  });
});
