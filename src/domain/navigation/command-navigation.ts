import type { FmccRole, Permission } from "@/domain/security/permissions";
import { roleHasPermission } from "@/domain/security/permissions";

export type CommandNavigationFeature = "kordena-commercial";

export interface CommandNavigationFeatures {
  readonly kordenaCommercial?: boolean;
}

export interface CommandNavigationItem {
  readonly href: string;
  readonly label: string;
  readonly icon: string;
  readonly permission: Permission;
  readonly exact?: boolean;
  readonly feature?: CommandNavigationFeature;
}

export const COMMAND_NAVIGATION: readonly CommandNavigationItem[] = [
  { href: "/dashboard", label: "Visão Geral", icon: "⌂", permission: "metric:read", exact: true },
  { href: "/dashboard/search", label: "Busca", icon: "⌕", permission: "search:use" },
  { href: "/dashboard/notifications", label: "Notificações", icon: "◌", permission: "notification:use" },
  { href: "/dashboard#product-intelligence-title", label: "Produtos", icon: "◇", permission: "product:read" },
  { href: "/dashboard/finance", label: "Financeiro", icon: "▥", permission: "metric:read" },
  { href: "/dashboard/billing", label: "Billing", icon: "¤", permission: "billing:read" },
  { href: "/dashboard/growth", label: "Comercial", icon: "↗", permission: "metric:read" },
  { href: "/dashboard/trials", label: "Trials", icon: "✓", permission: "metric:read" },
  { href: "/dashboard/subscriptions", label: "Assinaturas", icon: "♙", permission: "metric:read" },
  { href: "/dashboard/customers", label: "Clientes", icon: "◎", permission: "metric:read" },
  { href: "/dashboard/operations", label: "Operações", icon: "◉", permission: "metric:read" },
  { href: "/dashboard/alerts", label: "Incidentes", icon: "△", permission: "alert:read" },
  { href: "/dashboard/activity", label: "Atividades", icon: "≡", permission: "audit:read" },
  { href: "/dashboard/intelligence", label: "Core", icon: "⬡", permission: "metric:read" },
  { href: "/dashboard/commercial/kordena", label: "Kordena", icon: "K", permission: "commercial:read", feature: "kordena-commercial" },
  { href: "/dashboard/sources", label: "Fontes e Integrações", icon: "⚙", permission: "source:read" },
  { href: "/dashboard/settings", label: "Configurações", icon: "☷", permission: "metric:read" },
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
