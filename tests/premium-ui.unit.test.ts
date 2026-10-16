import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APPROVED_COMMAND_ARTWORK_SRC } from "../src/presentation/command-approved-artwork";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("F18 premium UX/UI", () => {
  it("possui design system responsivo, foco visível e reduced motion", () => {
    const css = source("src/app/globals.css");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media(max-width:980px)");
    expect(css).toContain("@media(max-width:720px)");
    expect(css).toContain("@media(max-width:520px)");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
    expect(css).toContain("--surface-strong");
    expect(css).toContain("--focus:");
  });

  it("mostra resumo executivo factual sem score sintético", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    expect(dashboard).toContain('className="command-overview"');
    expect(dashboard).toContain("Exigem atenção");
    expect(dashboard).toContain("Cobertura factual");
    expect(dashboard).toContain("Produtos ativos");
    expect(dashboard).toContain("alertOverview.occurrences.filter");
    expect(dashboard).not.toMatch(/health\s*score/i);
    expect(dashboard).not.toContain("Math.random");
  });

  it("oferece atalhos governados e evidência acessível no Core", () => {
    const core = source("src/app/dashboard/core-query-form.tsx");
    expect(core).toContain("O que precisa da minha atenção?");
    expect(core).toContain("Explique as principais variações da empresa.");
    expect(core).toContain("Quais são os principais riscos?");
    expect(core).toContain('className="core-evidence"');
    expect(core).toContain('aria-live="polite"');
    expect(core).toContain('type="button"');
  });

  it("remove marcador histórico de fase da entrada comercial", () => {
    const home = source("src/app/page.tsx");
    expect(home).toContain("Preview governado");
    expect(home).not.toContain("Fase 06");
  });

  it("não renderiza escapes literais no grid executivo", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    expect(dashboard).not.toContain('\\n        <Link href="/dashboard/');
  });

  it("mantém alertas com preview e sem botão de execução crítica", () => {
    const alerts = source("src/app/dashboard/alerts/alert-control-panel.tsx");
    expect(alerts).toContain("Preparar investigação");
    expect(alerts).not.toContain("/execute");
  });

  it("mantém o shell mobile sem navegação sticky sobre o conteúdo e resume o tenant", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    const css = source("src/app/globals.css");

    expect(css).toContain("correção responsiva mobile pós-validação visual");
    expect(css).toContain(".command-sidebar{\n    position:relative;");
    expect(css).toContain(".command-content{\n    overflow:visible;");
    expect(dashboard).toContain("Organização ativa");
    expect(dashboard).not.toContain("context.tenantId.slice(0, 6)");
    expect(dashboard).not.toContain("context.tenantId.slice(-4)");
  });

  it("usa a arte aprovada real na abertura e preserva o fluxo real de autenticação", () => {
    const signIn = source("src/app/sign-in/page.tsx");
    const authCss = source("src/app/command-auth-premium.css");

    expect(signIn).toContain("APPROVED_COMMAND_ARTWORK_SRC");
    expect(signIn).not.toContain("CommandBrainLogo");
    expect(signIn).toContain('className="command-approved-artwork"');
    expect(signIn).toContain('alt="FM Command"');
    expect(signIn).toContain('className="command-auth-shell"');
    expect(signIn).toContain("Comande sua operação com");
    expect(signIn).toContain("inteligência governada.");
    expect(signIn).toContain("authClient.signIn.email");
    expect(signIn).toContain("authClient.signUp.email");
    expect(signIn).toContain("Criar uma conta");
    expect(signIn).not.toContain("Entrar com Microsoft");
    expect(signIn).not.toContain("Entrar com Google");
    expect(authCss).toContain(".command-auth-layout");
    expect(authCss).toContain(".command-auth-card");
    expect(authCss).toContain(".command-approved-artwork");
    expect(authCss).toContain("mix-blend-mode:screen");
    expect(authCss).toContain("@media(max-width:680px)");

    const prefix = "data:image/webp;base64,";
    expect(APPROVED_COMMAND_ARTWORK_SRC.startsWith(prefix)).toBe(true);
    const approvedBytes = Buffer.from(APPROVED_COMMAND_ARTWORK_SRC.slice(prefix.length), "base64");
    expect(approvedBytes.byteLength).toBe(53526);
    expect(approvedBytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(approvedBytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(createHash("sha256").update(approvedBytes).digest("hex")).toBe(
      "319b6a4a3254b34a75383e1e6013bfa0bf487e421349ee5b37cc2c01cb9dd5a4",
    );
  });

  it("aplica o visual premium aprovado no shell global e mantém a navegação governada", () => {
    const shell = source("src/app/dashboard/command-shell.tsx");
    const layout = source("src/app/dashboard/layout.tsx");
    const navigation = source("src/domain/navigation/command-navigation.ts");
    const core = source("src/app/dashboard/core-query-form.tsx");
    const css = source("src/app/globals.css");

    expect(layout).toContain("notifications={notifications}");
    expect(shell).toContain("FM Tecnologia");
    expect(shell).toContain("COMMAND");
    expect(shell).toContain("commandNavigationForRole(role, integrationFeatures)");
    expect(navigation).toContain("Visão Geral");
    expect(navigation).toContain("Financeiro");
    expect(navigation).toContain("Comercial");
    expect(navigation).toContain("Operações");
    expect(navigation).toContain("Incidentes");
    expect(navigation).toContain("Core");
    expect(core).toContain("FM COMMAND CORE");
    expect(core).toContain("INTELIGÊNCIA COGNITIVA VERTICAL");
    expect(core).toContain("APPROVED_COMMAND_ARTWORK_SRC");
    expect(core).not.toContain("core-orb-note");
    expect(css).toContain("--command-blue:#1f7aff");
    expect(css).toContain("--command-cyan:#00d9ff");
    expect(css).toContain("--command-violet:#8b5cf6");
    expect(css).toContain(".command-sidebar");
    expect(css).toContain(".command-topbar");
    expect(css).toContain(".core-approved-artwork");
  });
});
