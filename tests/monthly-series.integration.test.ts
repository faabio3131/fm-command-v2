import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { createUnitComparisonService } from "@/application/metrics/metric-composition";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { canonicalFacts } from "@/infrastructure/db/platform-schema";
import { orgUnits, unitGrants } from "@/infrastructure/db/unit-schema";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

const T = "serie-a";
const REV = "revenue.cash_collected";
const SP = "America/Sao_Paulo";
const NOW = new Date("2026-10-17T14:00:00Z");
const service = createUnitComparisonService();
const units = new PostgresUnitRepository();
const ctx = (role: TenantContext["role"] = "owner", userId = "owner"): TenantContext => ({ tenantId: T, userId, role, correlationId: "c" });
const sourceId = randomUUID();
let b1: string; let b2: string; let b3: string; let sul: string;

async function pay(unitId: string, at: string, amount: number, currency = "BRL") {
  await db.insert(canonicalFacts).values({
    tenantId: T, unitId, sourceId, externalId: `${unitId}-${at}-${amount}`, factType: "payment.settled",
    payload: { amount, currency, status: "settled" }, mappingVersion: "v1", sourceTimestamp: new Date(at),
  });
}
async function cleanup() {
  await db.delete(canonicalFacts).where(inArray(canonicalFacts.tenantId, [T]));
  await db.delete(unitGrants).where(inArray(unitGrants.tenantId, [T]));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, [T]));
}
const series = (c = ctx(), months = 3) => service.monthlySeries(c, { metricId: REV, months, timeZone: SP, now: NOW });

beforeAll(async () => {
  await cleanup();
  const company = (await units.createUnit({ tenantId: T, kind: "company", parentId: null, name: "Matriz" })).id;
  sul = (await units.createUnit({ tenantId: T, kind: "region", parentId: company, name: "Sul" })).id;
  b1 = (await units.createUnit({ tenantId: T, kind: "branch", parentId: sul, name: "B1" })).id;
  b2 = (await units.createUnit({ tenantId: T, kind: "branch", parentId: sul, name: "B2" })).id;
  b3 = (await units.createUnit({ tenantId: T, kind: "branch", parentId: company, name: "B3" })).id;
  // Agosto: só B1. Setembro: B1 + B2. Outubro: B1 + B2 + B3. Fato exatamente na virada (01/10 00:00 em SP) conta só em outubro.
  await pay(b1, "2026-08-15T12:00:00Z", 1000);
  await pay(b1, "2026-09-10T12:00:00Z", 2000);
  await pay(b2, "2026-09-20T12:00:00Z", 3000.5);
  await pay(b1, "2026-10-01T03:00:00Z", 500);
  await pay(b2, "2026-10-05T12:00:00Z", 100);
  await pay(b3, "2026-10-06T12:00:00Z", 50);
});
afterAll(cleanup);

describe("série mensal calculada dos fatos", () => {
  it("soma as filiais mês a mês, com cobertura, e não conta o fato da virada em dois meses", async () => {
    const s = await series();
    expect(s?.points.map((p) => p.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(s?.points[0].comparison.total).toMatchObject({ status: "available", value: "1000", reporting: 1, expected: 3, partial: true });
    expect(s?.points[1].comparison.total).toMatchObject({ status: "available", value: "5000.5", reporting: 2, expected: 3 });
    expect(s?.points[2].comparison.total).toMatchObject({ status: "available", value: "650", reporting: 3, expected: 3, partial: false });
    expect(s?.points.map((p) => p.closed)).toEqual([true, true, false]);
  });

  it("mês sem nenhum fato fica indisponível, nunca zero", async () => {
    const s = await series(ctx(), 5);
    expect(s?.points[0].key).toBe("2026-06");
    expect(s?.points[0].comparison.total).toMatchObject({ status: "unavailable", reason: "no_data" });
    expect(JSON.stringify(s?.points[0])).not.toContain('"value":"0');
  });

  it("guarda o valor de cada filial no mês, com ranking", async () => {
    const s = await series();
    const sep = s?.points[1].comparison.branches ?? [];
    expect(sep.find((b) => b.unitId === b2)).toMatchObject({ value: "3000.5", rank: 1 });
    expect(sep.find((b) => b.unitId === b3)).toMatchObject({ value: null, rank: null });
  });

  it("moedas diferentes no mês tornam o total desse mês indisponível", async () => {
    await pay(b3, "2026-09-25T12:00:00Z", 9.99, "USD");
    const s = await series();
    expect(s?.points[1].comparison.total).toMatchObject({ status: "unavailable", reason: "mixed_currency" });
    expect(s?.points[0].comparison.total).toMatchObject({ status: "available" });
  });

  it("quem enxerga só a região recebe a série do que enxerga; sem concessão não recebe valor", async () => {
    await units.grant({ tenantId: T, userId: "gerente", unitId: sul, grantedBy: "owner" });
    const s = await series(ctx("member", "gerente"));
    expect(s?.points[2].comparison.total).toMatchObject({ status: "available", value: "600", reporting: 2, expected: 2 });
    const none = await series(ctx("member", "ninguem"));
    expect(none?.points.every((p) => p.comparison.total.status === "unavailable")).toBe(true);
  });

  it("métrica de posição não tem série (null), em vez de inventar o passado", async () => {
    const r = await service.monthlySeries(ctx(), { metricId: "finance.receivable.open_amount", months: 3, timeZone: SP, now: NOW }).catch((e: Error) => e);
    expect(r === null || r instanceof Error).toBe(true);
  });

  it("recusa pedir mais de 24 meses", async () => {
    await expect(series(ctx(), 25)).rejects.toThrow("metrics.series_months_invalid");
  });
});
