import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("CME-06 Notifications UI/API contract", () => {
  it("resolve tenant server-side e não aceita tenant da requisição", () => {
    const api = source("src/app/api/notifications/route.ts");
    expect(api).toContain("resolveTenantContext(await headers())");
    expect(api).not.toContain("x-tenant-id");
    expect(api).not.toContain("tenantId?:");
    expect(api).toContain("NotificationNotFoundError");
  });

  it("badge deriva unreadCount real e dropdown aponta para a central", () => {
    const shell = source("src/app/dashboard/command-shell.tsx");
    const layout = source("src/app/dashboard/layout.tsx");

    expect(layout).toContain("buildNotificationService()");
    expect(layout).toContain("unreadCount: inbox.unreadCount");
    expect(shell).toContain("notifications?.unreadCount ?? 0");
    expect(shell).toContain('href="/dashboard/notifications"');
    expect(shell).not.toContain("unread = 3");
  });

  it("página permite marcar lida e mantém reconhecimento no serviço de Alertas", () => {
    const page = source("src/app/dashboard/notifications/page.tsx");
    const list = source(
      "src/app/dashboard/notifications/notification-list.tsx",
    );

    expect(page).toContain("Reconhecimento de alerta continua no serviço de Alertas");
    expect(list).toContain('fetch("/api/notifications"');
    expect(list).toContain("Marcar como lida");
    expect(list).toContain("Abrir origem");
    expect(list).not.toContain("/api/alerts/acknowledge");
  });

  it("possui empty/loading/error e rota governada na navegação", () => {
    const list = source(
      "src/app/dashboard/notifications/notification-list.tsx",
    );
    const loading = source("src/app/dashboard/notifications/loading.tsx");
    const error = source("src/app/dashboard/notifications/error.tsx");
    const navigation = source("src/domain/navigation/command-navigation.ts");

    expect(list).toContain("Nenhuma notificação governada.");
    expect(loading).toContain('aria-busy="true"');
    expect(error).toContain('role="alert"');
    expect(navigation).toContain('href: "/dashboard/notifications"');
    expect(navigation).toContain('permission: "notification:use"');
  });
});
