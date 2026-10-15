import type { FmccRole, Permission } from "./permissions";
import { roleHasPermission } from "./permissions";

export class AuthenticationRequiredError extends Error { constructor(){ super("security.authentication_required"); } }
export class TenantScopeRequiredError extends Error { constructor(){ super("security.tenant_scope_required"); } }
export class CrossTenantAccessError extends Error { constructor(){ super("security.cross_tenant_access_denied"); } }
export class PermissionDeniedError extends Error { constructor(permission: Permission){ super(`security.permission_denied:${permission}`); } }

export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: FmccRole;
  readonly correlationId: string;
}
export function assertTenantScope(context: TenantContext, requestedTenantId: string): void {
  if (!requestedTenantId || requestedTenantId !== context.tenantId) throw new CrossTenantAccessError();
}
export function requirePermission(context: TenantContext, permission: Permission): void {
  if (!roleHasPermission(context.role, permission)) throw new PermissionDeniedError(permission);
}
