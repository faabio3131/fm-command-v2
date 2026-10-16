import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { deploymentEnvironmentLabel, readDeploymentIdentity } from "@/application/deployment/deployment-identity";
import { loadTenantIntegrationFeatures } from "@/application/integration/tenant-integration-features";
import { buildNotificationService } from "@/application/notifications/notification-composition";
import { loadDashboardIdentity } from "@/application/security/dashboard-identity";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { roleHasPermission } from "@/domain/security/permissions";
import {
  AuthenticationRequiredError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { CommandShell } from "./command-shell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let context;
  try {
    context = await resolveTenantContext(await headers());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof TenantScopeRequiredError) redirect("/onboarding");
    throw error;
  }

  const [notifications, identity, integrationFeatures] = await Promise.all([
    roleHasPermission(context.role, "notification:use")
      ? buildNotificationService()
          .inbox(context, 5)
          .then((inbox) => ({
            unreadCount: inbox.unreadCount,
            items: inbox.items,
          }))
          .catch(() => null)
      : Promise.resolve(null),
    loadDashboardIdentity(context).catch(() => null),
    loadTenantIntegrationFeatures(context).catch(() => ({
      kordenaCommercial: false,
    })),
  ]);
  const environmentLabel = deploymentEnvironmentLabel(readDeploymentIdentity());

  return (
    <CommandShell
      role={context.role}
      notifications={notifications}
      identity={identity}
      environmentLabel={environmentLabel}
      integrationFeatures={integrationFeatures}
    >
      {children}
    </CommandShell>
  );
}
