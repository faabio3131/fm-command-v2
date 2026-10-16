import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import { RateLimiter } from "@/application/integration/rate-limiter";
import { createMetricService } from "@/application/metrics/metric-composition";
import { MetricRecomputeService } from "@/application/metrics/metric-recompute-service";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { sourceCredentials } from "@/infrastructure/db/credential-schema";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { canonicalFacts, metricValues, sourceDefinitions, syncExecutions } from "@/infrastructure/db/platform-schema";
import { orgUnits } from "@/infrastructure/db/unit-schema";
import { OmieClient } from "@/infrastructure/connectors/omie/omie-client";
import { OmieConnector } from "@/infrastructure/connectors/omie/omie-connector";
import { PostgresCredentialStore } from "@/infrastructure/integration/postgres-credential-store";
import { PostgresCanonicalFactRepository, PostgresSourceRepository, PostgresSyncRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";
import { OmieSimulator, receivable } from "./support/omie-simulator";

const A = "s2n-a";
const B = "s2n-b";
const KEY = randomBytes(32);
const store = new PostgresCredentialStore(() => KEY);
const sources = new PostgresSourceRepository();
const units = new PostgresUnitRepository();
const metricStore = new PostgresMetricStore();
const ctx = (tenantId: string, role: TenantContext["role"] = "owner"): TenantContext => ({ tenantId, userId: `u-${tenantId}`, role, correlationId: "c" });
let branch: string;

async function cleanup() {
  const t = [A, B];
  await db.delete(metricValues).where(inArray(metricValues.tenantId, t));
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, t));
  await db.delete(canonicalFacts).where(inArray(canonicalFacts.tenantId, t));
  await db.delete(syncExecutions).where(inArray(syncExecutions.tenantId, t));
  await db.delete(sourceDefinitions).where(inArray(sourceDefinitions.tenantId, t));
  await db.delete(sourceCredentials).where(inArray(sourceCredentials.tenantId, t));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, t));
}
beforeAll(async () => {
  await cleanup();
  const hq = await units.createUnit({ tenantId: A, kind: "company", parentId: null, name: "Matriz" });
  branch = (await units.createUnit({ tenantId: A, kind: "branch", parentId: hq.id, name: "Filial 1" })).id;
});
afterAll(cleanup);

const recompute = () => new MetricRecomputeService({
  metrics: createMetricService(), factScopes: (t) => metricStore.distinctFactScopes(t), tenantIds: async () => [A], timeZone: async () => "America/Sao_Paulo",
});
const rowCount = async (tenantId: string) => (await db.select().from(metricValues).where(eq(metricValues.tenantId, tenantId))).length;

describe("da fonte ao número (ERP simulado → fatos → métricas)", () => {
  it("a sincronização recalcula sozinha; valores por filial exatos; título sem valor deixa o total da empresa indisponível", async () => {
    const sim = new OmieSimulator();
    sim.accounts.set("KEY-A", {
      appSecret: "sec-a", payables: [],
      receivables: [
        receivable(1, { codigo_departamento: "D1", status_titulo: "A VENCER", valor_documento: 100.5 }),
        receivable(2, { codigo_departamento: "D1", status_titulo: "ATRASADO", valor_documento: 200.25 }),
        receivable(3, { codigo_departamento: "D1", status_titulo: "RECEBIDO", valor_documento: 999 }),
        receivable(4, { status_titulo: "A VENCER", valor_documento: undefined }), // sem filial e sem valor
      ],
    });
    await store.save(A, "vault:s2n", { kind: "api_key_pair", appKey: "KEY-A", appSecret: "sec-a" });
    const source = await sources.create(A, {
      name: "Omie", sourceType: "omie", authoritativeDomain: "finance", syncMode: "pull",
      secretRef: "vault:s2n", config: { unitRefField: "codigo_departamento", unitMap: { D1: branch } },
    });
    const service = recompute();
    const runtime = new ConnectorRuntime(
      sources, new PostgresSyncRepository(), new PostgresCanonicalFactRepository(),
      [new OmieConnector(new OmieClient(sim, new RateLimiter()), store)], undefined, undefined, undefined,
      (tenantId, correlationId) => service.recomputeTenant(tenantId, correlationId),
    );
    expect(await runtime.syncPull(ctx(A), { sourceId: source.id, idempotencyKey: "s2n-1" })).toMatchObject({ status: "completed", ingested: 4 });

    // A filial: 100.50 em aberto + 200.25 vencido; o liquidado (999) fica de fora.
    const open = await metricStore.latestValue(A, "finance.receivable.open_amount", undefined, branch);
    expect(open).toMatchObject({ value: "300.75", unit: "currency", currency: "BRL" });
    expect(await metricStore.latestValue(A, "finance.receivable.overdue_amount", undefined, branch)).toMatchObject({ value: "200.25" });
    // Empresa (sem filial): só o título 4, que não tem valor → indisponível, nunca zero.
    const company = await metricStore.latestValue(A, "finance.receivable.open_amount");
    expect(company?.value).toBeNull();
    expect(company?.qualityStatus).toBe("missing");
    // Sem fato de pagar, nada foi calculado (não inventa linha).
    expect(await metricStore.latestValue(A, "finance.payable.open_amount", undefined, branch)).toBeNull();
    // Outra empresa não vê nada.
    expect(await metricStore.latestValue(B, "finance.receivable.open_amount", undefined, branch)).toBeNull();

    // A tela lê pelo MetricService com o escopo de unidades.
    const viaService = await createMetricService().query(ctx(A), "finance.receivable.open_amount", undefined, branch);
    expect(viaService?.value).toBe("300.75");
  });

  it("recalcular sem mudança não grava linha nova; mudança no ERP grava e o valor novo vale", async () => {
    const before = await rowCount(A);
    const service = recompute();
    await service.recomputeTenant(A, "again-1");
    await service.recomputeTenant(A, "again-2");
    expect(await rowCount(A)).toBe(before);

    // O ERP baixa o título 1 (vira recebido): em aberto da filial cai para 200.25.
    const sim = new OmieSimulator();
    sim.accounts.set("KEY-A", {
      appSecret: "sec-a", payables: [],
      receivables: [receivable(1, { codigo_departamento: "D1", status_titulo: "RECEBIDO", valor_documento: 100.5, info: { dAlt: "06/10/2026", hAlt: "10:30:00" } })],
    });
    const [source] = await db.select().from(sourceDefinitions).where(eq(sourceDefinitions.tenantId, A));
    const runtime = new ConnectorRuntime(
      sources, new PostgresSyncRepository(), new PostgresCanonicalFactRepository(),
      [new OmieConnector(new OmieClient(sim, new RateLimiter()), store)], undefined, undefined, undefined,
      (tenantId, correlationId) => service.recomputeTenant(tenantId, correlationId),
    );
    await runtime.syncPull(ctx(A), { sourceId: source.id, idempotencyKey: "s2n-2" });
    expect(await metricStore.latestValue(A, "finance.receivable.open_amount", undefined, branch)).toMatchObject({ value: "200.25" });
    expect(await rowCount(A)).toBeGreaterThan(before);
  });

  it("falha no recálculo não derruba a sincronização", async () => {
    const sim = new OmieSimulator();
    sim.accounts.set("KEY-A", { appSecret: "sec-a", payables: [], receivables: [receivable(9, { codigo_departamento: "D1" })] });
    const [source] = await db.select().from(sourceDefinitions).where(eq(sourceDefinitions.tenantId, A));
    const runtime = new ConnectorRuntime(
      sources, new PostgresSyncRepository(), new PostgresCanonicalFactRepository(),
      [new OmieConnector(new OmieClient(sim, new RateLimiter()), store)], undefined, undefined, undefined,
      async () => { throw new Error("recálculo fora do ar"); },
    );
    expect(await runtime.syncPull(ctx(A), { sourceId: source.id, idempotencyKey: "s2n-3" })).toMatchObject({ status: "completed", ingested: 1 });
  });
});
