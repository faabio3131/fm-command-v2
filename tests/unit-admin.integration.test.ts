import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { buildUnitAdminService } from "@/application/organization/unit-admin-composition";
import { UnitInputError, UnitInUseError, UnitProtectedError, UnitValidationError } from "@/application/organization/unit-admin-service";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { member, organization, user } from "@/infrastructure/db/auth-schema";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { metricValues, sourceDefinitions } from "@/infrastructure/db/platform-schema";
import { orgUnits, unitGrants } from "@/infrastructure/db/unit-schema";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

const A = "ua-org-a";
const B = "ua-org-b";
const service = buildUnitAdminService();
const repo = new PostgresUnitRepository();
const ctx = (tenantId: string, role: TenantContext["role"] = "owner", userId = `owner-${tenantId}`): TenantContext => ({ tenantId, userId, role, correlationId: "c" });

async function cleanup() {
  const t = [A, B];
  await db.delete(metricValues).where(inArray(metricValues.tenantId, t));
  await db.delete(sourceDefinitions).where(inArray(sourceDefinitions.tenantId, t));
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, t));
  await db.delete(unitGrants).where(inArray(unitGrants.tenantId, t));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, t));
  await db.delete(member).where(inArray(member.organizationId, t));
  await db.delete(organization).where(inArray(organization.id, t));
  await db.delete(user).where(inArray(user.id, ["ua-owner", "ua-gerente", "ua-outro"]));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(organization).values([{ id: A, name: "A", slug: "ua-a" }, { id: B, name: "B", slug: "ua-b" }]);
  await db.insert(user).values([
    { id: "ua-owner", name: "Dona", email: "ua-owner@example.com" }, { id: "ua-gerente", name: "Gerente", email: "ua-gerente@example.com" }, { id: "ua-outro", name: "Outro", email: "ua-outro@example.com" },
  ]);
  await db.insert(member).values([
    { id: "ua-m1", userId: "ua-owner", organizationId: A, role: "owner" }, { id: "ua-m2", userId: "ua-gerente", organizationId: A, role: "member" },
    { id: "ua-m3", userId: "ua-outro", organizationId: B, role: "member" },
  ]);
});
afterAll(cleanup);

describe("gestão da estrutura da empresa", () => {
  let company: string; let region: string; let branch: string; let branch2: string;

  it("cria a matriz uma única vez, depois região e filiais", async () => {
    const first = await service.ensureCompany(ctx(A), "  Matriz A  ", { countryCode: "BR", currency: "BRL" });
    expect(first.created).toBe(true); expect(first.unit.name).toBe("Matriz A");
    const again = await service.ensureCompany(ctx(A), "Outro nome");
    expect(again).toMatchObject({ created: false, unit: { id: first.unit.id, name: "Matriz A" } });
    company = first.unit.id;
    region = (await service.create(ctx(A), { kind: "region", parentId: company, name: "Sul" })).id;
    branch = (await service.create(ctx(A), { kind: "branch", parentId: region, name: "Curitiba" })).id;
    branch2 = (await service.create(ctx(A), { kind: "branch", parentId: company, name: "São Paulo", timezone: "America/Sao_Paulo" })).id;
    expect((await service.overview(ctx(A))).units).toHaveLength(4);
  });

  it("recusa estrutura inválida com código estável", async () => {
    await expect(service.create(ctx(A), { kind: "branch", parentId: branch, name: "Filha de filial" })).rejects.toBeInstanceOf(UnitValidationError);
    await expect(service.create(ctx(A), { kind: "branch", parentId: null, name: "Sem pai" })).rejects.toBeInstanceOf(UnitValidationError);
    await expect(service.create(ctx(A), { kind: "company", parentId: null, name: "Segunda matriz" })).rejects.toBeInstanceOf(UnitInputError);
    await expect(service.create(ctx(A), { kind: "region", parentId: company, name: "   " })).rejects.toThrow("unit.name_required");
    await expect(service.create(ctx(A), { kind: "region", parentId: company, name: "x".repeat(121) })).rejects.toThrow("unit.name_too_long");
    await expect(service.create(ctx(A), { kind: "branch", parentId: company, name: "Moeda ruim", currency: "BRLX" })).rejects.toBeInstanceOf(UnitValidationError);
  });

  it("não aceita pai de outra empresa", async () => {
    await service.ensureCompany(ctx(B), "Matriz B");
    await expect(service.create(ctx(B), { kind: "branch", parentId: company, name: "Intruso" })).rejects.toBeInstanceOf(UnitValidationError);
    expect((await service.overview(ctx(B))).units.map((u) => u.name)).toEqual(["Matriz B"]);
  });

  it("renomeia, move e recusa ciclo", async () => {
    expect((await service.rename(ctx(A), branch2, "São Paulo Centro")).name).toBe("São Paulo Centro");
    await service.move(ctx(A), branch2, region);
    expect((await repo.listUnits(A)).find((u) => u.id === branch2)?.parentId).toBe(region);
    await expect(service.move(ctx(A), company, region)).rejects.toBeInstanceOf(UnitValidationError);
    await expect(service.move(ctx(A), region, branch)).rejects.toBeInstanceOf(UnitValidationError);
  });

  it("remove só unidade vazia; matriz, unidade com filhas e unidade com dados ficam", async () => {
    await expect(service.remove(ctx(A), company)).rejects.toBeInstanceOf(UnitProtectedError);
    await expect(service.remove(ctx(A), region)).rejects.toBeInstanceOf(UnitInUseError);
    await db.insert(metricValues).values({ tenantId: A, unitId: branch, metricId: "x", metricVersion: 1, value: "1", unit: "count", freshnessStatus: "fresh", qualityStatus: "ok", sourceAuthority: "t" });
    await expect(service.remove(ctx(A), branch)).rejects.toBeInstanceOf(UnitInUseError);
    expect((await repo.listUnits(A)).some((u) => u.id === branch)).toBe(true);
    // Fonte cujo mapa de filiais ainda aponta para a unidade: não sai (a sincronização falharia).
    const [source] = await db.insert(sourceDefinitions).values({ tenantId: A, name: "ERP", sourceType: "omie", authoritativeDomain: "finance", syncMode: "pull", config: { unitMap: { F2: branch2 } } }).returning();
    await expect(service.remove(ctx(A), branch2)).rejects.toBeInstanceOf(UnitInUseError);
    await db.delete(sourceDefinitions).where(inArray(sourceDefinitions.id, [source.id]));
    await service.remove(ctx(A), branch2);
    expect((await repo.listUnits(A)).some((u) => u.id === branch2)).toBe(false);
  });

  it("concede unidades só a quem é da empresa e só de unidades da empresa; troca é completa", async () => {
    await service.setGrants(ctx(A), "ua-gerente", [branch, branch, region]);
    expect((await repo.listGrants(A, "ua-gerente")).map((g) => g.unitId).sort()).toEqual([branch, region].sort());
    await service.setGrants(ctx(A), "ua-gerente", [branch]);
    expect((await repo.listGrants(A, "ua-gerente")).map((g) => g.unitId)).toEqual([branch]);
    await expect(service.setGrants(ctx(A), "ua-outro", [branch])).rejects.toThrow("unit.grant_user_not_member");
    await expect(service.setGrants(ctx(A), "ua-gerente", [(await repo.listUnits(B))[0].id])).rejects.toThrow("unit.grant_unit_unknown");
    expect((await repo.listGrants(A, "ua-gerente")).map((g) => g.unitId)).toEqual([branch]);
    const view = await service.overview(ctx(A));
    expect(view.members.map((m) => m.userId).sort()).toEqual(["ua-gerente", "ua-owner"]);
    expect(view.grants).toHaveLength(1);
  });

  it("o escopo muda de verdade: membro sem concessão não vê nada; com concessão vê a unidade; dono vê tudo", async () => {
    await service.setGrants(ctx(A), "ua-gerente", []);
    expect((await repo.scopeFor(ctx(A, "member", "ua-gerente"))).kind).toBe("units");
    const none = await repo.scopeFor(ctx(A, "member", "ua-gerente"));
    expect(none.kind === "units" && none.unitIds.size).toBe(0);
    await service.setGrants(ctx(A), "ua-gerente", [region]);
    const some = await repo.scopeFor(ctx(A, "member", "ua-gerente"));
    expect(some.kind === "units" && [...some.unitIds].sort()).toEqual([branch, region].sort());
    expect((await repo.scopeFor(ctx(A))).kind).toBe("all");
  });

  it("só dono e administrador administram; os demais papéis são negados", async () => {
    for (const role of ["analyst", "viewer", "member"] as const) {
      await expect(service.overview(ctx(A, role))).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(service.create(ctx(A, role), { kind: "region", parentId: company, name: "Z" })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(service.setGrants(ctx(A, role), "ua-gerente", [])).rejects.toBeInstanceOf(PermissionDeniedError);
    }
    await expect(service.overview(ctx(A, "admin"))).resolves.toBeTruthy();
  });

  it("audita cada mudança, sem nome de unidade nem dados pessoais", async () => {
    const rows = await db.select().from(auditEvents).where(inArray(auditEvents.tenantId, [A]));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["unit.created", "unit.renamed", "unit.moved", "unit.removed", "unit.grants.replaced"]) expect(actions.has(a), a).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/Curitiba|São Paulo|ua-gerente@/);
  });
});
