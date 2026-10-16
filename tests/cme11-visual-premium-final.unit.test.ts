import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("CME-11 Visual Premium Final", () => {
  it("mantém o shell premium com busca global real e identidade FM Command", () => {
    const shell = source("src/app/dashboard/command-shell.tsx");

    expect(shell).toContain('href="/dashboard/search"');
    expect(shell).toContain("Buscar no COMMAND...");
    expect(shell).toContain("FM Tecnologia");
    expect(shell).toContain("<strong>COMMAND</strong>");
    expect(shell).toContain("environmentLabel");
  });

  it("usa o artwork oficial do Core sem alterar o contrato cognitivo", () => {
    const core = source("src/app/dashboard/core-query-form.tsx");

    expect(core).toContain("APPROVED_COMMAND_ARTWORK_SRC");
    expect(core).toContain('className="command-approved-artwork core-approved-artwork"');
    expect(core).not.toContain("CommandBrainLogo");
    expect(core).not.toContain("core-orb-note");
    expect(core).toContain('fetch("/api/core/query"');
    expect(core).toContain("Proveniência:");
  });

  it("compõe a visão geral com Core, saúde, serviços, alertas e atividade reais", () => {
    const dashboard = source("src/app/dashboard/page.tsx");

    expect(dashboard).toContain('className="dashboard-shell dashboard-home-compact"');
    expect(dashboard).toContain('className="command-home-stage"');
    expect(dashboard).toContain("Saúde Operacional");
    expect(dashboard).toContain("Alertas e Incidentes");
    expect(dashboard).toContain("Atividades recentes");
    expect(dashboard).toContain("operationalHealth.services");
    expect(dashboard).toContain("alertOverview.occurrences");
    expect(dashboard).toContain("Indisponível");
  });

  it("compacta notificações sem alterar seu contrato funcional", () => {
    const notifications = source("src/app/dashboard/notifications/page.tsx");
    const notificationList = source("src/app/dashboard/notifications/notification-list.tsx");

    expect(notifications).toContain('className="dashboard-shell dashboard-shell-compact notifications-compact"');
    expect(notifications).toContain("buildNotificationService().inbox");
    expect(notificationList).toContain("Nenhuma notificação governada");
    expect(notificationList).toContain('fetch("/api/notifications"');
  });

  it("preserva a política de dados ausentes e não introduz números conceituais do mock", () => {
    const dashboard = source("src/app/dashboard/page.tsx");

    expect(dashboard).toContain('if (value === null) return "Indisponível"');
    expect(dashboard).not.toContain("412.8");
    expect(dashboard).not.toContain("4,95 mi");
    expect(dashboard).not.toContain("28,4%");
    expect(dashboard).not.toContain("1.248");
  });

  it("possui design system premium responsivo para shell, Core e rail operacional", () => {
    const css = source("src/app/globals.css");

    expect(css).toContain("CME-11 — VISUAL PREMIUM FINAL");
    expect(css).toContain(".command-global-search");
    expect(css).toContain(".command-home-stage");
    expect(css).toContain(".command-health-ring");
    expect(css).toContain(".command-status-pill.operational");
    expect(css).toContain(".command-activity-grid");
    expect(css).toContain(".core-approved-artwork");
    expect(css).toContain("CME-11.2 — compactação da primeira dobra");
    expect(css).toContain(".dashboard-home-compact");
    expect(css).toContain(".notifications-compact");
    expect(css).toContain("@media(max-width:980px)");
    expect(css).toContain("@media(max-width:720px)");
  });
});
