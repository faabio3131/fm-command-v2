import type { FmccRole, Permission } from "@/domain/security/permissions";
import { roleHasPermission } from "@/domain/security/permissions";

export type NavLabelKey =
  | "nav.overview" | "nav.search" | "nav.notifications" | "nav.products" | "nav.finance" | "nav.billing"
  | "nav.commercial" | "nav.trials" | "nav.subscriptions" | "nav.customers" | "nav.operations"
  | "nav.incidents" | "nav.activity" | "nav.core" | "nav.kordena" | "nav.sources" | "nav.settings";

export type CommandNavigationFeature = "kordena-commercial";

export interface CommandNavigationFeatures {
  readonly kordenaCommercial?: boolean;
}

export interface CommandNavigationItem {
  readonly href: string;
  /** Rótulo em pt-BR (idioma de origem). A tela usa `labelKey` no catálogo de cada idioma. */
  readonly label: string;
  readonly labelKey: NavLabelKey;
  readonly icon: string;
  readonly permission: Permission;
  readonly exact?: boolean;
  readonly feature?: CommandNavigationFeature;
}

export const COMMAND_NAVIGATION: readonly CommandNavigationItem[] = [
  { href: "/dashboard", label: "Visão Geral", labelKey: "nav.overview", icon: "⌂", permission: "metric:read", exact: true },
  { href: "/dashboard/search", label: "Busca", labelKey: "nav.search", icon: "⌕", permission: "search:use" },
  { href: "/dashboard/notifications", label: "Notificações", labelKey: "nav.notifications", icon: "◌", permission: "notification:use" },
  { href: "/dashboard#product-intelligence-title", label: "Produtos", labelKey: "nav.products", icon: "◇", permission: "product:read" },
  { href: "/dashboard/finance", label: "Financeiro", labelKey: "nav.finance", icon: "▥", permission: "metric:read" },
  { href: "/dashboard/billing", label: "Billing", labelKey: "nav.billing", icon: "¤", permission: "billing:read" },
  { href: "/dashboard/growth", label: "Comercial", labelKey: "nav.commercial", icon: "↗", permission: "metric:read" },
  { href: "/dashboard/trials", label: "Trials", labelKey: "nav.trials", icon: "✓", permission: "metric:read" },
  { href: "/dashboard/subscriptions", label: "Assinaturas", labelKey: "nav.subscriptions", icon: "♙", permission: "metric:read" },
  { href: "/dashboard/customers", label: "Clientes", labelKey: "nav.customers", icon: "◎", permission: "metric:read" },
  { href: "/dashboard/operations", label: "Operações", labelKey: "nav.operations", icon: "◉", permission: "metric:read" },
  { href: "/dashboard/alerts", label: "Incidentes", labelKey: "nav.incidents", icon: "△", permission: "alert:read" },
  { href: "/dashboard/activity", label: "Atividades", labelKey: "nav.activity", icon: "≡", permission: "audit:read" },
  { href: "/dashboard/intelligence", label: "Core", labelKey: "nav.core", icon: "⬡", permission: "metric:read" },
  { href: "/dashboard/commercial/kordena", label: "Kordena", labelKey: "nav.kordena", icon: "K", permission: "commercial:read", feature: "kordena-commercial" },
  { href: "/dashboard/sources", label: "Fontes e Integrações", labelKey: "nav.sources", icon: "⚙", permission: "source:read" },
  { href: "/dashboard/settings", label: "Configurações", labelKey: "nav.settings", icon: "☷", permission: "metric:read" },
];

function featureEnabled(
  item: CommandNavigationItem,
  features: CommandNavigationFeatures,
): boolean {
  if (!item.feature) return true;
  if (item.feature === "kordena-commercial") {
    return features.kordenaCommercial === true;
  }
  return false;
}

export function commandNavigationForRole(
  role: FmccRole,
  features: CommandNavigationFeatures = {},
): readonly CommandNavigationItem[] {
  return COMMAND_NAVIGATION.filter(
    (item) =>
      roleHasPermission(role, item.permission) &&
      featureEnabled(item, features),
  );
}
