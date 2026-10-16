import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { LivePulseService } from "@/application/live/live-pulse-service";
import { createUnitScopeResolver } from "@/application/organization/unit-scope";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { metricValues } from "@/infrastructure/db/platform-schema";
import { orgUnits, unitGrants } from "@/infrastructure/db/unit-schema";
import { PostgresLivePulseRepository } from "@/infrastructure/live/postgres-live-pulse-repository";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";

const A = "live-a";
const B = "live-b";
const repo = new PostgresUnitRepository();
const store = new PostgresMetricStore();
const ctx = (tenantId: string, userId: string, role: TenantContext["role"]): TenantContext => ({ tenantId, userId, role, correlationId: `c-${userId}` });
const pulse = (context: TenantContext) => new LivePulseService(new PostgresLivePulseRepository(), createUnitScopeResolver()).pulse(context).then((p) => p.token);
let hq: string, sul: string, norte: string, cwb: string, man: string;

const save = (tenantId: string, unitId: string | undefined, at: Date) => store.saveValue({
  tenantId, unitId, metricId: "revenue.cash_collected", metricVersion: 1, value: "1", unit: "currency", currency: "BRL", computedAt: at,
  freshnessStatus: "fresh", qualityStatus: "verified", sourceAuthority: "teste", provenanceRefs: [],
});
const audit = (tenantId: string, at: Date) => db.insert(auditEvents).values({
  tenantId, actorId: "x", actorType: "user", action: "alert.raised", resourceType: "alert_occurrence", resourceId: "r", result: "attention", correlationId: `live-${at.getTime()}`, occurredAt: at,
});
async function cleanup() {
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, [A, B]));
  await db.delete(metricValues).where(inArray(metricValues.tenantId, [A, B]));
  await db.delete(unitGrants).where(inArray(unitGrants.tenantId, [A, B]));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, [A, B]));
}

beforeAll(async () => {
  await cleanup();
  hq = (await repo.createUnit({ tenantId: A, kind: "company", parentId: null, name: "Matriz" })).id;
  sul = (await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "Sul" })).id;
  norte = (await repo.createUnit({ tenantId: A, kind: "region", parentId: hq, name: "Norte" })).id;
  cwb = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: sul, name: "Curitiba" })).id;
  man = (await repo.createUnit({ tenantId: A, kind: "branch", parentId: norte, name: "Manaus" })).id;
  await repo.grant({ tenantId: A, userId: "gerente-sul", unitId: sul, grantedBy: "owner" });
  await save(A, cwb, new Date("2026-10-01T10:00:00Z"));
});
afterAll(cleanup);

describe("marca de mudança com banco", () => {
  const owner = ctx(A, "dono", "owner");
  const gerente = ctx(A, "gerente-sul", "analyst");

  it("dono: muda com valor novo de qualquer unidade e com evento de auditoria", async () => {
    const t0 = await pulse(owner);
    expect(await pulse(owner)).toBe(t0);
    await save(A, man, new Date("2026-10-01T11:00:00Z"));
    const t1 = await pulse(owner);
    expect(t1).not.toBe(t0);
    await audit(A, new Date("2026-10-01T12:00:00Z"));
    expect(await pulse(owner)).not.toBe(t1);
  });

  it("gerente do Sul: não muda com dado de fora do escopo nem com auditoria; muda com dado do Sul", async () => {
    const t0 = await pulse(gerente);
    await save(A, man, new Date("2026-10-02T09:00:00Z"));
    await audit(A, new Date("2026-10-02T09:30:00Z"));
    expect(await pulse(gerente)).toBe(t0);
    await save(A, cwb, new Date("2026-10-02T10:00:00Z"));
    expect(await pulse(gerente)).not.toBe(t0);
  });

  it("quem não tem nenhuma unidade concedida não recebe mudança nenhuma", async () => {
    const sem = ctx(A, "sem-concessao", "analyst");
    const t0 = await pulse(sem);
    await save(A, cwb, new Date("2026-10-03T10:00:00Z"));
    await audit(A, new Date("2026-10-03T10:05:00Z"));
    expect(await pulse(sem)).toBe(t0);
  });

  it("mudança em outra empresa não mexe na marca desta", async () => {
    const t0 = await pulse(owner);
    await save(B, undefined, new Date("2026-10-04T10:00:00Z"));
    await audit(B, new Date("2026-10-04T10:05:00Z"));
    expect(await pulse(owner)).toBe(t0);
  });
});
