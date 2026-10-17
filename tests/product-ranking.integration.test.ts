import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { inArray } from "drizzle-orm";
import { ConnectorRuntime } from "@/application/integration/connector-runtime";
import { RateLimiter } from "@/application/integration/rate-limiter";
import { createDimensionRankingService, createMetricService } from "@/application/metrics/metric-composition";
import { DimensionRankingService } from "@/application/metrics/dimension-ranking-service";
import { MetricRecomputeService } from "@/application/metrics/metric-recompute-service";
import { MetricService } from "@/application/metrics/metric-service";
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
import { OmieSimulator, orderItem, salesOrder } from "./support/omie-simulator";

const A = "prod-rank-a";
const B = "prod-rank-b";
const KEY = randomBytes(32);
const store = new PostgresCredentialStore(() => KEY);
const sources = new PostgresSourceRepository();
const units = new PostgresUnitRepository();
const metricStore = new PostgresMetricStore();
const ctx = (tenantId: string): TenantContext => ({ tenantId, userId: `u-${tenantId}`, role: "owner", correlationId: "c" });
let curitiba: string;
let manaus: string;

/** dd/mm/yyyy de hoje e do mês passado no fuso de São Paulo, sem datas fixas. */
function spDate(monthsBack = 0): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1 - monthsBack, monthsBack ? 15 : p[2]));
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
const TODAY = spDate();
const LAST_MONTH = spDate(1);
const fat = (date: string, over: Record<string, unknown> = {}) => ({ cFaturado: "S", cCancelado: "N", dInc: date, hInc: "08:00:00", dFat: date, hFat: "09:00:00", dAlt: date, hAlt: "09:01:00", ...over });
const at = (empresa: number) => ({ codigo_empresa: empresa });
const line = (seq: number, reais: number) => orderItem(seq, { valor_total: reais, valor_unitario: reais, quantidade: 1 });

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
  curitiba = (await units.createUnit({ tenantId: A, kind: "branch", parentId: hq.id, name: "Curitiba" })).id;
  manaus = (await units.createUnit({ tenantId: A, kind: "branch", parentId: hq.id, name: "Manaus" })).id;
  const sim = new OmieSimulator();
  sim.accounts.set("KEY-A", {
    appSecret: "sec-a", receivables: [], payables: [], stock: [],
    salesOrders: [
      salesOrder(1, { total: 1000, cabecalho: at(1), infoCadastro: fat(TODAY), itens: [line(1, 600), line(2, 400)] }),
      salesOrder(2, { total: 300, cabecalho: at(1), infoCadastro: fat(TODAY), itens: [line(1, 300)] }),
      salesOrder(3, { total: 600, cabecalho: at(2), infoCadastro: fat(TODAY), itens: [line(1, 500), line(3, 100)] }),
      salesOrder(4, { total: 9999, cabecalho: at(2), infoCadastro: fat(TODAY, { cCancelado: "S" }), itens: [line(2, 9999)] }), // cancelado
      salesOrder(5, { total: 7777, cabecalho: at(1), infoCadastro: fat(LAST_MONTH), itens: [line(3, 7777)] }), // mês anterior
      salesOrder(6, { total: 50, cabecalho: at(1), infoCadastro: fat(TODAY), itens: [orderItem(4, { codigo_produto: undefined, valor_total: 50 })] }), // sem código de produto
    ],
  });
  await store.save(A, "vault:pr", { kind: "api_key_pair", appKey: "KEY-A", appSecret: "sec-a" });
  const source = await sources.create(A, {
    name: "Omie pedidos", sourceType: "omie", authoritativeDomain: "sales", syncMode: "pull", secretRef: "vault:pr",
    config: { streams: ["sales_order"], unitRefField: "cabecalho.codigo_empresa", unitMap: { "1": curitiba, "2": manaus } },
  });
  const recompute = new MetricRecomputeService({ metrics: createMetricService(), factScopes: (t) => metricStore.distinctFactScopes(t), tenantIds: async () => [A], timeZone: async () => "America/Sao_Paulo" });
  const runtime = new ConnectorRuntime(
    sources, new PostgresSyncRepository(), new PostgresCanonicalFactRepository(), [new OmieConnector(new OmieClient(sim, new RateLimiter()), store)],
    undefined, undefined, undefined, (tenantId, correlationId) => recompute.recomputeTenant(tenantId, correlationId),
  );
  expect(await runtime.syncPull(ctx(A), { sourceId: source.id, idempotencyKey: "pr-1" })).toMatchObject({ status: "completed" });
});
afterAll(cleanup);

const rank = (context: TenantContext, over: Record<string, unknown> = {}) =>
  createDimensionRankingService().rank(context, { metricId: "sales.items.invoiced_amount", dimension: "productRef", timeZone: "America/Sao_Paulo", ...over } as never);

describe("ranking por produto até o número (ERP simulado)", () => {
  it("soma as linhas dos pedidos faturados do mês por produto, nas duas filiais, sem cancelado, sem mês anterior e sem linha sem código", async () => {
    const view = await rank(ctx(A));
    expect(view.ranking.rows.map((r) => [r.key, r.label, r.value, r.rank, r.sharePercent])).toEqual([
      ["301", "Produto 1", "1400", 1, "73.7"], // 600 + 300 (Curitiba) + 500 (Manaus)
      ["302", "Produto 2", "400", 2, "21.1"], // o cancelado de 9999 fica fora
      ["303", "Produto 3", "100", 3, "5.3"], // o de 7777 foi no mês anterior
    ]);
    expect(view.ranking.total).toEqual({ value: "1900", currency: "BRL" });
    expect(view.ranking.withoutDimension).toBe(1);
    expect(view.branchCount).toBe(2);
    expect(view.fullCompany).toBe(true);
  });

  it("o total do ranking bate com as vendas faturadas por pedido das mesmas filiais (menos a linha sem produto)", async () => {
    const [c, m] = await Promise.all([curitiba, manaus].map((u) => metricStore.latestValue(A, "sales.orders.invoiced_amount", undefined, u)));
    expect(c?.value).toBe("1350"); // 1000 + 300 + 50
    expect(m?.value).toBe("600");
    // 1350 + 600 = 1950; menos os 50 da linha sem código de produto = 1900.
  });

  it("o mês anterior mostra só o que foi faturado nele", async () => {
    const view = await rank(ctx(A), { periodKind: "previous" });
    expect(view.ranking.rows.map((r) => [r.key, r.value])).toEqual([["303", "7777"]]);
  });

  it("o limite corta só a lista mostrada; total e participação seguem sobre todos os produtos", async () => {
    const view = await rank(ctx(A), { limit: 1 });
    expect(view.ranking.rows.map((r) => r.key)).toEqual(["301"]);
    expect(view.ranking.total?.value).toBe("1900");
    expect(view.ranking.rows[0].sharePercent).toBe("73.7");
  });

  it("quem só enxerga a filial de Curitiba vê o ranking só dela (escopo de unidades)", async () => {
    const repository = new PostgresUnitRepository();
    const scoped = new DimensionRankingService(
      new MetricService(new PostgresMetricStore(), async () => ({ kind: "units", unitIds: new Set([curitiba]) })),
      (tenantId) => repository.listUnits(tenantId),
      async () => ({ kind: "units", unitIds: new Set([curitiba]) }),
    );
    const view = await scoped.rank(ctx(A), { metricId: "sales.items.invoiced_amount", dimension: "productRef", timeZone: "America/Sao_Paulo" });
    expect(view.ranking.rows.map((r) => [r.key, r.value])).toEqual([["301", "900"], ["302", "400"]]);
    expect(view.branchCount).toBe(1);
    expect(view.fullCompany).toBe(false);
  });

  it("outra empresa não vê nada; limite e métrica inválidos são recusados", async () => {
    const other = await rank(ctx(B));
    expect(other.ranking.rows).toEqual([]);
    expect(other.ranking.total).toBeNull();
    await expect(rank(ctx(A), { limit: 0 })).rejects.toThrow("metrics.ranking_limit_invalid");
    await expect(rank(ctx(A), { metricId: "inventory.below_minimum.count" })).rejects.toThrow("metrics.ranking_period_required");
    await expect(rank(ctx(A), { metricId: "nao.existe" })).rejects.toThrow("metrics.definition_not_found");
  });
});
