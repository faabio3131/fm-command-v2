import { eq } from "drizzle-orm";
import {
  authorizedAvatarUrl,
  initialsFromName,
  type DashboardIdentity,
} from "@/domain/security/dashboard-identity";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { organization, user } from "@/infrastructure/db/auth-schema";

export async function loadDashboardIdentity(
  context: TenantContext,
): Promise<DashboardIdentity> {
  const [users, organizations] = await Promise.all([
    db
      .select({ name: user.name, image: user.image })
      .from(user)
      .where(eq(user.id, context.userId))
      .limit(1),
    db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, context.tenantId))
      .limit(1),
  ]);

  const name = users[0]?.name?.trim() || null;
  return {
    name,
    initials: initialsFromName(name),
    imageUrl: authorizedAvatarUrl(users[0]?.image ?? null),
    organizationName: organizations[0]?.name?.trim() || null,
  };
}
