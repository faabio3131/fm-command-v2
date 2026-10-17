import type { OrgUnit, UnitKind } from "@/domain/organization/unit-hierarchy";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import { UnitInUseError, UnitNotFoundError, UnitProtectedError, UnitValidationError, type PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

export { UnitInUseError, UnitNotFoundError, UnitProtectedError, UnitValidationError };
export class UnitInputError extends Error { constructor(code: string) { super(code); this.name = "UnitInputError"; } }

export interface UnitAdminAudit {
  record(input: { tenantId: string; actorId: string; action: string; resourceType: string; resourceId: string | null; result: string; correlationId: string; metadata: Record<string, unknown> }): Promise<void>;
}
export interface UnitAdminDeps {
  readonly repository: Pick<PostgresUnitRepository, "listUnits" | "createUnit" | "moveUnit" | "renameUnit" | "removeUnit" | "replaceGrants" | "listMembers" | "listAllGrants">;
  readonly audit: UnitAdminAudit;
}
export interface CreateUnitInput { kind: UnitKind; parentId: string | null; name: string; countryCode?: string; timezone?: string; currency?: string }

/**
 * Gestão da estrutura da empresa: matriz, regiões, filiais e quem enxerga o quê.
 * Atenção ao efeito de criar a primeira unidade: a partir daí, quem não é dono nem administrador só vê as unidades concedidas.
 */
export class UnitAdminService {
  constructor(private readonly deps: UnitAdminDeps) {}

  async overview(context: TenantContext) {
    requirePermission(context, "unit:read");
    const [units, members, grants] = await Promise.all([
      this.deps.repository.listUnits(context.tenantId), this.deps.repository.listMembers(context.tenantId), this.deps.repository.listAllGrants(context.tenantId),
    ]);
    return { units, members, grants };
  }

  /** Cria a matriz se ainda não houver; se houver, devolve a existente. */
  async ensureCompany(context: TenantContext, name: string, profile: { countryCode?: string; timezone?: string; currency?: string } = {}): Promise<{ unit: OrgUnit; created: boolean }> {
    requirePermission(context, "unit:write");
    const existing = (await this.deps.repository.listUnits(context.tenantId)).find((u) => u.kind === "company");
    if (existing) return { unit: existing, created: false };
    const unit = await this.deps.repository.createUnit({ tenantId: context.tenantId, kind: "company", parentId: null, name: this.cleanName(name), ...profile });
    await this.audit(context, "unit.created", unit.id, { kind: "company" });
    return { unit, created: true };
  }

  async create(context: TenantContext, input: CreateUnitInput): Promise<OrgUnit> {
    requirePermission(context, "unit:write");
    if (input.kind === "company") throw new UnitInputError("unit.use_ensure_company");
    const unit = await this.deps.repository.createUnit({ tenantId: context.tenantId, kind: input.kind, parentId: input.parentId, name: this.cleanName(input.name), countryCode: input.countryCode, timezone: input.timezone, currency: input.currency });
    await this.audit(context, "unit.created", unit.id, { kind: unit.kind });
    return unit;
  }

  async rename(context: TenantContext, unitId: string, name: string): Promise<OrgUnit> {
    requirePermission(context, "unit:write");
    const unit = await this.deps.repository.renameUnit(context.tenantId, unitId, this.cleanName(name));
    await this.audit(context, "unit.renamed", unitId, {});
    return unit;
  }

  async move(context: TenantContext, unitId: string, parentId: string): Promise<OrgUnit> {
    requirePermission(context, "unit:write");
    const unit = await this.deps.repository.moveUnit(context.tenantId, unitId, parentId);
    await this.audit(context, "unit.moved", unitId, {});
    return unit;
  }

  async remove(context: TenantContext, unitId: string): Promise<void> {
    requirePermission(context, "unit:write");
    await this.deps.repository.removeUnit(context.tenantId, unitId);
    await this.audit(context, "unit.removed", unitId, {});
  }

  /** Define de uma vez as unidades que a pessoa enxerga. Só quem é da empresa pode receber. */
  async setGrants(context: TenantContext, userId: string, unitIds: readonly string[]): Promise<void> {
    requirePermission(context, "unit:write");
    const [members, units] = await Promise.all([this.deps.repository.listMembers(context.tenantId), this.deps.repository.listUnits(context.tenantId)]);
    if (!members.some((m) => m.userId === userId)) throw new UnitInputError("unit.grant_user_not_member");
    const known = new Set(units.map((u) => u.id));
    const unique = [...new Set(unitIds)];
    if (unique.some((id) => !known.has(id))) throw new UnitInputError("unit.grant_unit_unknown");
    await this.deps.repository.replaceGrants({ tenantId: context.tenantId, userId, unitIds: unique, grantedBy: context.userId });
    await this.audit(context, "unit.grants.replaced", userId, { count: unique.length });
  }

  private cleanName(name: string): string {
    const trimmed = (name ?? "").trim();
    if (!trimmed) throw new UnitInputError("unit.name_required");
    if (trimmed.length > 120) throw new UnitInputError("unit.name_too_long");
    return trimmed;
  }
  private audit(context: TenantContext, action: string, resourceId: string, metadata: Record<string, unknown>) {
    return this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action, resourceType: "org_unit", resourceId, result: "success", correlationId: context.correlationId, metadata });
  }
}

