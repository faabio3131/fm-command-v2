import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { normalizeRole } from "@/domain/security/permissions";
import { AuthenticationRequiredError, TenantScopeRequiredError, type TenantContext } from "@/domain/security/tenant-context";
import { auth } from "@/infrastructure/auth/auth";
import { db } from "@/infrastructure/db/client";
import { member } from "@/infrastructure/db/auth-schema";

function correlationId(headers: Headers): string {
  const proposed = headers.get("x-correlation-id")?.trim();
  return proposed && /^[A-Za-z0-9._:-]{1,128}$/.test(proposed) ? proposed : randomUUID();
}

export async function resolveTenantContext(headers: Headers): Promise<TenantContext> {
  const sessionData = await auth.api.getSession({ headers });
  if (!sessionData) throw new AuthenticationRequiredError();
  const tenantId = sessionData.session.activeOrganizationId?.trim();
  if (!tenantId) throw new TenantScopeRequiredError();

  const membership = await db.select({ role: member.role }).from(member).where(
    and(eq(member.userId, sessionData.user.id), eq(member.organizationId, tenantId))
  ).limit(1);
  if (membership.length !== 1) throw new TenantScopeRequiredError();

  return { tenantId, userId: sessionData.user.id, role: normalizeRole(membership[0].role), correlationId: correlationId(headers) };
}
