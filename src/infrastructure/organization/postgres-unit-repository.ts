import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { member, user } from "@/infrastructure/db/auth-schema";
import { orgUnits, unitGrants } from "@/infrastructure/db/unit-schema";
import {
  resolveUnitScope, validateUnitChange, type OrgUnit, type UnitGrant, type UnitKind, type UnitScope,
} from "@/domain/organization/unit-hierarchy";
import type { TenantContext } from "@/domain/security/tenant-context";

export class UnitValidationError extends Error {
  constructor(readonly errors: readonly string[]) { super(`organization.unit_invalid:${errors.join(",")}`); }
}
export class UnitNotFoundError extends Error { constructor() { super("organization.unit_not_found"); } }
export class UnitInUseError extends Error { constructor() { super("organization.unit_in_use"); } }
export class UnitProtectedError extends Error { constructor() { super("organization.unit_protected"); } }

type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

function mapUnit(row: typeof orgUnits.$inferSelect): OrgUnit {
  return {
    id: row.id, tenantId: row.tenantId, parentId: row.parentId, kind: row.kind as UnitKind, name: row.name,
    ...(row.countryCode ? { countryCode: row.countryCode } : {}),
    ...(row.timezone ? { timezone: row.timezone } : {}),
    ...(row.currency ? { currency: row.currency } : {}),
  };
}

async function loadUnits(tx: Executor, tenantId: string): Promise<OrgUnit[]> {
  return (await tx.select().from(orgUnits).where(eq(orgUnits.tenantId, tenantId))).map(mapUnit);
}

/** Edições da árvore de uma empresa são serializadas: duas mudanças simultâneas não criam ciclo. */
async function lockTenantTree(tx: Executor, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"fmcc_org_unit:" + tenantId}))`);
}

export class PostgresUnitRepository {
  async listUnits(tenantId: string): Promise<readonly OrgUnit[]> {
    return loadUnits(db, tenantId);
  }

  async createUnit(input: {
    tenantId: string; kind: UnitKind; parentId: string | null; name: string;
    countryCode?: string; timezone?: string; currency?: string;
  }): Promise<OrgUnit> {
    return db.transaction(async (tx) => {
      await lockTenantTree(tx, input.tenantId);
      const existing = await loadUnits(tx, input.tenantId);
      const candidate: OrgUnit = { id: randomUUID(), ...input };
      const checked = validateUnitChange(existing, candidate);
      if (!checked.ok) throw new UnitValidationError(checked.errors);
      await tx.insert(orgUnits).values({
        id: candidate.id, tenantId: candidate.tenantId, parentId: candidate.parentId, kind: candidate.kind, name: candidate.name,
        countryCode: candidate.countryCode, timezone: candidate.timezone, currency: candidate.currency,
      });
      return candidate;
    });
  }

  async moveUnit(tenantId: string, unitId: string, newParentId: string): Promise<OrgUnit> {
    return db.transaction(async (tx) => {
      await lockTenantTree(tx, tenantId);
      const existing = await loadUnits(tx, tenantId);
      const current = existing.find((u) => u.id === unitId);
      if (!current) throw new UnitNotFoundError();
      const moved: OrgUnit = { ...current, parentId: newParentId };
      const checked = validateUnitChange(existing, moved);
      if (!checked.ok) throw new UnitValidationError(checked.errors);
      await tx.update(orgUnits).set({ parentId: newParentId, updatedAt: new Date() })
        .where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.id, unitId)));
      return moved;
    });
  }

  async renameUnit(tenantId: string, unitId: string, name: string): Promise<OrgUnit> {
    return db.transaction(async (tx) => {
      await lockTenantTree(tx, tenantId);
      const existing = await loadUnits(tx, tenantId);
      const current = existing.find((u) => u.id === unitId);
      if (!current) throw new UnitNotFoundError();
      const renamed: OrgUnit = { ...current, name };
      const checked = validateUnitChange(existing, renamed);
      if (!checked.ok) throw new UnitValidationError(checked.errors);
      await tx.update(orgUnits).set({ name, updatedAt: new Date() }).where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.id, unitId)));
      return renamed;
    });
  }

  /** Só remove unidade vazia: sem filhas e sem dado ligado a ela (chaves do banco recusam o resto). A matriz nunca sai. */
  async removeUnit(tenantId: string, unitId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await lockTenantTree(tx, tenantId);
      const existing = await loadUnits(tx, tenantId);
      const current = existing.find((u) => u.id === unitId);
      if (!current) throw new UnitNotFoundError();
      if (current.kind === "company") throw new UnitProtectedError();
      if (existing.some((u) => u.parentId === unitId)) throw new UnitInUseError();
      try {
        await tx.delete(orgUnits).where(and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.id, unitId)));
      } catch (error) {
        const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
        if (code === "23503") throw new UnitInUseError();
        throw error;
      }
    });
  }

  /** Troca todas as concessões da pessoa de uma vez; unidade de outra empresa é recusada pela chave composta. */
  async replaceGrants(input: { tenantId: string; userId: string; unitIds: readonly string[]; grantedBy: string }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(unitGrants).where(and(eq(unitGrants.tenantId, input.tenantId), eq(unitGrants.userId, input.userId)));
      if (input.unitIds.length > 0) {
        await tx.insert(unitGrants).values(input.unitIds.map((unitId) => ({ tenantId: input.tenantId, userId: input.userId, unitId, grantedBy: input.grantedBy })));
      }
    });
  }

  async listMembers(tenantId: string): Promise<readonly { userId: string; name: string; email: string; role: string }[]> {
    return db.select({ userId: member.userId, name: user.name, email: user.email, role: member.role })
      .from(member).innerJoin(user, eq(user.id, member.userId)).where(eq(member.organizationId, tenantId));
  }

  async listAllGrants(tenantId: string): Promise<readonly UnitGrant[]> {
    const rows = await db.select().from(unitGrants).where(eq(unitGrants.tenantId, tenantId));
    return rows.map((r) => ({ tenantId: r.tenantId, userId: r.userId, unitId: r.unitId }));
  }

  async grant(input: { tenantId: string; userId: string; unitId: string; grantedBy: string }): Promise<void> {
    // A chave composta (tenant_id, unit_id) recusa unidade de outra empresa.
    await db.insert(unitGrants).values(input).onConflictDoNothing();
  }

  async revoke(tenantId: string, userId: string, unitId: string): Promise<void> {
    await db.delete(unitGrants).where(and(
      eq(unitGrants.tenantId, tenantId), eq(unitGrants.userId, userId), eq(unitGrants.unitId, unitId),
    ));
  }

  async listGrants(tenantId: string, userId: string): Promise<readonly UnitGrant[]> {
    const rows = await db.select().from(unitGrants).where(and(eq(unitGrants.tenantId, tenantId), eq(unitGrants.userId, userId)));
    return rows.map((r) => ({ tenantId: r.tenantId, userId: r.userId, unitId: r.unitId }));
  }

  /** Escopo de unidades da pessoa autenticada, sempre dentro da empresa do contexto. */
  async scopeFor(context: TenantContext): Promise<UnitScope> {
    const [units, grants] = await Promise.all([
      this.listUnits(context.tenantId), this.listGrants(context.tenantId, context.userId),
    ]);
    return resolveUnitScope({ tenantId: context.tenantId, userId: context.userId, role: context.role, units, grants });
  }
}
