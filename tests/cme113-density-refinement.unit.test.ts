import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("CME-11.3 — premium density refinement", () => {
  it("aplica compactação exclusiva às três rotas alvo", () => {
    const growth = source("src/app/dashboard/growth/page.tsx");
    const customers = source("src/app/dashboard/customers/page.tsx");
    const settings = source("src/app/dashboard/settings/page.tsx");

    expect(growth).toContain('dashboard-shell dashboard-shell-compact growth-compact');
    expect(customers).toContain('dashboard-shell dashboard-shell-compact customers-compact');
    expect(settings).toContain('dashboard-shell dashboard-shell-compact settings-compact');
  });

  it("preserva conteúdo e estados governados das telas", () => {
    const growth = source("src/app/dashboard/growth/page.tsx");
    const customers = source("src/app/dashboard/customers/page.tsx");
    const settings = source("src/app/dashboard/settings/page.tsx");

    expect(growth).toContain("Semântica pendente");
    expect(growth).toContain("Indisponível");
    expect(growth).toContain("Atribuição e funil");

    expect(customers).toContain("Semântica pendente");
    expect(customers).toContain("Indisponível");
    expect(customers).toContain("Sinais factuais disponíveis");
    expect(customers).toContain("Risco e adoção");

    expect(settings).toContain("SettingsIdentityAdmin");
    expect(settings).toContain("Produtos, integrações e operação");
    expect(settings).toContain("Escopo ativo");
  });

  it("usa estilos específicos de densidade sem mascarar conteúdo", () => {
    const css = source("src/app/globals.css");

    expect(css).toContain("CME-11.3 — final premium density");
    expect(css).toContain(".growth-compact");
    expect(css).toContain(".customers-compact");
    expect(css).toContain(".settings-compact");
    expect(css).toContain(".settings-compact .command-action-grid");
    expect(css).toContain("body:has(.settings-compact) .command-sidebar-footer");
    expect(css).not.toMatch(/\.growth-compact[^}]*overflow\s*:\s*hidden/s);
    expect(css).not.toMatch(/\.customers-compact[^}]*overflow\s*:\s*hidden/s);
    expect(css).not.toMatch(/\.settings-compact[^}]*overflow\s*:\s*hidden/s);
  });

  it("preserva adaptação abaixo de 981px", () => {
    const css = source("src/app/globals.css");
    expect(css).toContain("@media(min-width:981px)");
    expect(css).toContain("@media(max-width:980px)");
  });
});
