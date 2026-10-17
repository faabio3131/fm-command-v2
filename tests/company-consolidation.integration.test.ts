import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { createUnitComparisonService } from "@/application/metrics/metric-composition";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { metricValues } from "@/infrastructure/db/platform-schema";
import { orgUnits, unitGrants } from "@/infrastructure/db/unit-schema";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

const T = "consol-a";
const EMPTY = "consol-vazia";
const REV = "revenue.cash_collected";
const service = createUnitComparisonService();
const units = new PostgresUnitRepository();
const ctx = (tenantId: string, role: TenantContext["role"] = "owner", userId = "owner"): TenantContext => ({ tenantId, userId, role, correlationId: "c" });
let b1: string; let b2: string; let b3: string; let sul: string;

async function put(unitId: string, metricId: string, value: string | null, currency: string | undefined, unit = "currency") {
  await db.insert(metricValues).values({
    tenantId: T, unitId, metricId, metricVersion: 1, value, unit, currency, periodKind: "current", freshnessStatus: "fresh", qualityStatus: "verified", sourceAuthority: "t",
  });
}
async function cleanup() {
  await db.delete(metricValues).where(inArray(metricValues.tenantId, [T, EMPTY]));
  await db.delete(unitGrants).where(inArray(unitGrants.tenantId, [T, EMPTY]));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, [T, EMPTY]));
}
const total = async (c: TenantContext, metricId = REV) => (await service.consolidate(c, { metricIds: [metricId] })).get(metricId);

beforeAll(async () => {
  await cleanup();
  const company = (await units.createUnit({ tenantId: T, kind: "company", parentId: null, name: "Matriz" })).id;
  sul = (await units.createUnit({ tenantId: T, kind: "region", parentId: company, name: "Sul" })).id;
  b1 = (await units.createUnit({ tenantId: T, kind: "branch", parentId: sul, name: "B1" })).id;
  b2 = (await units.createUnit({ tenantId: T, kind: "branch", parentId: sul, name: "B2" })).id;
  b3 = (await units.createUnit({ tenantId: T, kind: "branch", parentId: company, name: "B3" })).id;
  await put(b1, REV, "1000.50", "BRL");
  await put(b2, REV, "3000.25", "BRL");
  // b3 sem valor: não entra como zero.
});
afterAll(cleanup);

describe("consolidação da empresa a partir das filiais", () => {
  it("soma só as filiais com valor, com cobertura e marca de parcial; filial sem valor não vira zero", async () => {
    const r = await total(ctx(T));
    expect(r).toMatchObject({ fullCompany: true, total: { status: "available", value: "4000.75", currency: "BRL", reporting: 2, expected: 3, partial: true } });
  });

  it("completa quando todas as filiais têm valor", async () => {
    await put(b3, REV, "10.00", "BRL");
    expect((await total(ctx(T)))?.total).toMatchObject({ status: "available", value: "4010.75", reporting: 3, expected: 3, partial: false });
  });

  it("a soma usa o valor mais recente de cada filial", async () => {
    await put(b1, REV, "2000.50", "BRL");
    expect((await total(ctx(T)))?.total).toMatchObject({ value: "5010.75" });
  });

  it("moedas diferentes tornam o total indisponível, nunca uma soma errada", async () => {
    await put(b3, REV, "10.00", "USD");
    expect((await total(ctx(T)))?.total).toMatchObject({ status: "unavailable", reason: "mixed_currency" });
    await put(b3, REV, "10.00", "BRL");
  });

  it("contagem soma inteiros e não leva moeda", async () => {
    await put(b1, "lead.created.count", "3", undefined, "count");
    await put(b2, "lead.created.count", "4", undefined, "count");
    const r = await total(ctx(T), "lead.created.count");
    expect(r?.total).toMatchObject({ status: "available", value: "7", reporting: 2, expected: 3, partial: true });
    expect(r?.total).not.toHaveProperty("currency");
  });

  it("quem só enxerga uma região recebe a soma do que enxerga, marcada como não-empresa inteira", async () => {
    await units.grant({ tenantId: T, userId: "gerente", unitId: sul, grantedBy: "owner" });
    const r = await total(ctx(T, "member", "gerente"));
    expect(r?.fullCompany).toBe(false);
    expect(r?.total).toMatchObject({ status: "available", value: "5000.75", reporting: 2, expected: 2, partial: false }); // B1 2000,50 + B2 3000,25; B3 fica de fora
  });

  it("membro sem nenhuma concessão não recebe soma nenhuma", async () => {
    const r = await total(ctx(T, "member", "sem-acesso"));
    expect(r?.total).toMatchObject({ status: "unavailable", reason: "no_branches" });
  });

  it("empresa sem filiais devolve indisponível por falta de filiais, e outra empresa não vê estes valores", async () => {
    await units.createUnit({ tenantId: EMPTY, kind: "company", parentId: null, name: "Só matriz" });
    expect((await total(ctx(EMPTY)))?.total).toMatchObject({ status: "unavailable", reason: "no_branches" });
  });

  it("métrica desconhecida é ignorada, sem erro", async () => {
    expect((await service.consolidate(ctx(T), { metricIds: ["nao.existe"] })).size).toBe(0);
  });
});
