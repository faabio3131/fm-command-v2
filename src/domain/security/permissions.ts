export type FmccRole = "owner" | "admin" | "analyst" | "viewer" | "member";
export type Permission =
  | "tenant:manage" | "member:manage"
  | "source:read" | "source:write"
  | "metric:read" | "audit:read"
  | "integration:read" | "integration:write"
  | "product:read" | "product:write"
  | "alert:read" | "alert:write"
  | "action:prepare"
  | "commercial:read" | "commercial:write"
  | "billing:read" | "billing:write"
  | "receivable:read"
  | "search:use"
  | "notification:use";

const ROLE_PERMISSIONS: Record<FmccRole, ReadonlySet<Permission>> = {
  owner: new Set(["tenant:manage","member:manage","source:read","source:write","metric:read","audit:read","integration:read","integration:write","product:read","product:write","alert:read","alert:write","action:prepare","commercial:read","commercial:write","billing:read","billing:write","receivable:read","search:use","notification:use"]),
  admin: new Set(["member:manage","source:read","source:write","metric:read","audit:read","integration:read","integration:write","product:read","product:write","alert:read","alert:write","action:prepare","commercial:read","commercial:write","billing:read","billing:write","receivable:read","search:use","notification:use"]),
  analyst: new Set(["source:read","metric:read","audit:read","integration:read","product:read","alert:read","action:prepare","commercial:read","search:use","notification:use"]),
  viewer: new Set(["metric:read","integration:read","product:read","alert:read","commercial:read","search:use","notification:use"]),
  member: new Set(["metric:read","integration:read","product:read","alert:read","commercial:read","search:use","notification:use"]),
};

export function normalizeRole(role: string): FmccRole {
  if (role === "owner" || role === "admin" || role === "analyst" || role === "viewer") return role;
  return "member";
}
export function roleHasPermission(role: FmccRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
