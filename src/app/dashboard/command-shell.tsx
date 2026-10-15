"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import type { NotificationItem } from "@/domain/notifications/contracts";
import type { DashboardIdentity } from "@/domain/security/dashboard-identity";
import type { FmccRole } from "@/domain/security/permissions";
import { commandNavigationForRole, type CommandNavigationFeatures } from "@/presentation/command-navigation";
import { rotuloPapelFmcc } from "@/presentation/pt-br";
import { SignOutButton } from "./sign-out-button";

export function CommandShell({
  children,
  role,
  notifications,
  identity,
  environmentLabel,
  integrationFeatures,
}: {
  children: ReactNode;
  role: FmccRole;
  notifications: {
    readonly unreadCount: number;
    readonly items: readonly NotificationItem[];
  } | null;
  identity: DashboardIdentity | null;
  environmentLabel: string;
  integrationFeatures: CommandNavigationFeatures;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const navigation = commandNavigationForRole(role, integrationFeatures);

  useEffect(() => {
    const onGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();

      if (pathname === "/dashboard/search") {
        const input = document.getElementById("global-search-query");
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
        return;
      }

      router.push("/dashboard/search");
    };

    window.addEventListener("keydown", onGlobalSearchShortcut);
    return () => window.removeEventListener("keydown", onGlobalSearchShortcut);
  }, [pathname, router]);
  const unread = notifications?.unreadCount ?? 0;
  const roleLabel = rotuloPapelFmcc(role);
  const userName = identity?.name ?? "Usuário autenticado";
  const avatarStyle: CSSProperties | undefined = identity?.imageUrl
    ? { backgroundImage: "url(" + JSON.stringify(identity.imageUrl) + ")" }
    : undefined;

  return (
    <div className="command-app-shell">
      <header className="command-topbar">
        <Link href="/dashboard" className="command-brand" aria-label="FM Command — Visão Geral">
          <span className="command-brand-mark" aria-hidden="true">FM</span>
          <span className="command-brand-company">FM Tecnologia</span>
          <span className="command-brand-divider" aria-hidden="true" />
          <strong>COMMAND</strong>
        </Link>
        <p>Inteligência, controle e crescimento para o seu negócio.</p>
        <Link
          href="/dashboard/search"
          className="command-global-search"
          aria-label="Abrir busca global do FM Command"
        >
          <span aria-hidden="true">⌕</span>
          <span>Buscar no COMMAND...</span>
        </Link>
        <div className="command-topbar-actions">
          <details className="command-notification-menu">
            <summary
              className="command-topbar-badge"
              aria-label={
                notifications
                  ? "Notificações: " + unread + " não lidas"
                  : "Notificações: estado indisponível"
              }
            >
              <span aria-hidden="true">◌</span>
              Notificações
              {notifications && unread > 0 ? (
                <strong aria-label={unread + " notificações não lidas"}>
                  {unread}
                </strong>
              ) : null}
            </summary>
            <div className="panel">
              <strong>Central de Notificações</strong>
              {notifications ? (
                notifications.items.length ? (
                  <ul>
                    {notifications.items.map((item) => (
                      <li key={item.id}>
                        <Link href={item.href}>
                          {item.read ? "" : "● "}
                          {item.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Nenhuma notificação governada.</p>
                )
              ) : (
                <p>Estado de notificações indisponível.</p>
              )}
              <Link href="/dashboard/notifications">Abrir central</Link>
            </div>
          </details>

          <div
            className="command-topbar-badge command-environment-badge"
            aria-label={"Ambiente: " + environmentLabel}
          >
            <span aria-hidden="true">●</span>
            {environmentLabel}
          </div>

          <details className="command-user-menu">
            <summary
              className="command-topbar-badge"
              aria-label={"Usuário: " + userName + ", " + roleLabel}
            >
              <span
                className="command-user-avatar"
                style={avatarStyle}
                aria-hidden="true"
              >
                {identity?.imageUrl ? "" : identity?.initials ?? "○"}
              </span>
              <span>
                <strong>{userName}</strong>
                <small>{roleLabel}</small>
              </span>
            </summary>
            <div className="panel">
              <strong>{userName}</strong>
              <p>Papel: {roleLabel}</p>
              <p>
                Organização: {identity?.organizationName ?? "Nome indisponível"}
              </p>
              <p>Ambiente: {environmentLabel}</p>
              <Link href="/dashboard/settings">Abrir configurações</Link>
            </div>
          </details>

          <SignOutButton />
        </div>
      </header>

      <aside className="command-sidebar" aria-label="Navegação principal do FM Command">
        <nav>
          {navigation.map((item) => {
            const normalizedHref = item.href.split("#")[0];
            const active = "exact" in item && item.exact
              ? pathname === normalizedHref
              : normalizedHref !== "/dashboard" && pathname.startsWith(normalizedHref);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "command-nav-item active" : "command-nav-item"}
                aria-current={active ? "page" : undefined}
              >
                <span className="command-nav-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="command-sidebar-footer">
          <strong>FM COMMAND</strong>
          <span>{environmentLabel} · {identity?.organizationName ?? "Organização ativa"}</span>
        </div>
      </aside>

      <div className="command-content">{children}</div>
    </div>
  );
}
