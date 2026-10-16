"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import type { NotificationItem } from "@/domain/notifications/contracts";
import type { DashboardIdentity } from "@/domain/security/dashboard-identity";
import type { FmccRole } from "@/domain/security/permissions";
import { commandNavigationForRole } from "@/presentation/command-navigation";
import { LanguageSelector } from "@/i18n/react/language-selector";
import { useTranslator } from "@/i18n/react/i18n-provider";
import type { MessageKey } from "@/i18n/translate";
import { LiveRefresh } from "./live/live-refresh";
import { SignOutButton } from "./sign-out-button";

export function CommandShell({
  children,
  role,
  notifications,
  identity,
  environmentLabel,
}: {
  children: ReactNode;
  role: FmccRole;
  notifications: {
    readonly unreadCount: number;
    readonly items: readonly NotificationItem[];
  } | null;
  identity: DashboardIdentity | null;
  environmentLabel: string;
}) {
  const { t, plural } = useTranslator();
  const pathname = usePathname();
  const router = useRouter();
  const navigation = commandNavigationForRole(role);

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
  const roleLabel = t(`role.${role}` as MessageKey);
  const userName = identity?.name ?? t("shell.user.fallbackName");
  const avatarStyle: CSSProperties | undefined = identity?.imageUrl
    ? { backgroundImage: "url(" + JSON.stringify(identity.imageUrl) + ")" }
    : undefined;

  return (
    <div className="command-app-shell">
      <header className="command-topbar">
        <Link href="/dashboard" className="command-brand" aria-label={t("shell.brand.aria")}>
          <span className="command-brand-mark" aria-hidden="true">FM</span>
          <span className="command-brand-company">FM Tecnologia</span>
          <span className="command-brand-divider" aria-hidden="true" />
          <strong>COMMAND</strong>
        </Link>
        <p>{t("shell.brand.tagline")}</p>
        <Link
          href="/dashboard/search"
          className="command-global-search"
          aria-label={t("shell.search.aria")}
        >
          <span aria-hidden="true">⌕</span>
          <span>{t("shell.search.placeholder")}</span>
        </Link>
        <div className="command-topbar-actions">
          <details className="command-notification-menu">
            <summary
              className="command-topbar-badge"
              aria-label={
                notifications
                  ? plural("shell.notifications.ariaCount", unread)
                  : t("shell.notifications.ariaUnavailable")
              }
            >
              <span aria-hidden="true">◌</span>
              {t("shell.notifications.title")}
              {notifications && unread > 0 ? (
                <strong aria-label={plural("shell.notifications.badge", unread)}>
                  {unread}
                </strong>
              ) : null}
            </summary>
            <div className="panel">
              <strong>{t("shell.notifications.center")}</strong>
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
                  <p>{t("shell.notifications.empty")}</p>
                )
              ) : (
                <p>{t("shell.notifications.unavailable")}</p>
              )}
              <Link href="/dashboard/notifications">{t("shell.notifications.openCenter")}</Link>
            </div>
          </details>

          <LiveRefresh />

          <div
            className="command-topbar-badge command-environment-badge"
            aria-label={t("shell.env.aria", { env: environmentLabel })}
          >
            <span aria-hidden="true">●</span>
            {environmentLabel}
          </div>

          <details className="command-user-menu">
            <summary
              className="command-topbar-badge"
              aria-label={t("shell.user.aria", { name: userName, role: roleLabel })}
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
              <p>{t("shell.user.role", { role: roleLabel })}</p>
              <p>
                {t("shell.user.org", { org: identity?.organizationName ?? t("shell.user.orgUnavailable") })}
              </p>
              <p>{t("shell.user.env", { env: environmentLabel })}</p>
              <Link href="/dashboard/settings">{t("shell.user.openSettings")}</Link>
            </div>
          </details>

          <LanguageSelector />
          <SignOutButton />
        </div>
      </header>

      <aside className="command-sidebar" aria-label={t("shell.sidebar.aria")}>
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
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
        <div className="command-sidebar-footer">
          <strong>FM COMMAND</strong>
          <span>{environmentLabel} · {identity?.organizationName ?? t("shell.sidebar.orgFallback")}</span>
        </div>
      </aside>

      <div className="command-content">{children}</div>
    </div>
  );
}
