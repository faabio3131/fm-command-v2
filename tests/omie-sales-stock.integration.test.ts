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
import { OmieSimulator, orderItem, salesOrder, stockPosition } from "./support/omie-simulator";

const A = "omie-ss-a";
const B = "omie-ss-b";
const KEY = randomBytes(32);
const store = new PostgresCredentialStore(() => KEY);
const sources = new PostgresSourceRepository();
const units = new PostgresUnitRepository();
const metricStore = new PostgresMetricStore();
const ctx = (tenantId: string): TenantContext => ({ tenantId, userId: `u-${tenantId}`, role: "owner", correlationId: "c" });
let curitiba: string;
let manaus: string;

/** dd/mm/yyyy no fuso de São Paulo, a partir de hoje, sem datas fixas (o teste vale em qualquer mês). */
function spDate(offsetDays: number, monthsBack = 0): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1 - monthsBack, monthsBack ? 15 : parts[2] + offsetDays));
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
const TODAY = spDate(0);
const LAST_MONTH = spDate(0, 1);

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
});
afterAll(cleanup);

const recompute = () => new MetricRecomputeService({
  metrics: createMetricService(), factScopes: (t) => metricStore.distinctFactScopes(t), tenantIds: async () => [A], timeZone: async () => "America/Sao_Paulo",
});
const runtimeFor = (sim: OmieSimulator) => {
  const service = recompute();
  return new ConnectorRuntime(
    sources, new PostgresSyncRepository(), new PostgresCanonicalFactRepository(),
    [new OmieConnector(new OmieClient(sim, new RateLimiter()), store)], undefined, undefined, undefined,
    (tenantId, correlationId) => service.recomputeTenant(tenantId, correlationId),
  );
};
const fat = (date: string, over: Record<string, unknown> = {}) => ({ cFaturado: "S", cCancelado: "N", dInc: date, hInc: "08:00:00", dFat: date, hFat: "09:00:00", dAlt: date, hAlt: "09:01:00", ...over });
const at = (empresa: number) => ({ codigo_empresa: empresa });

describe("vendas e estoque do Omie até o número (8I, ERP simulado)", () => {
  let sourceId: string;

  it("pedidos faturados somam por filial no mês certo; orçamento, aberto e cancelado ficam fora; estoque abaixo do mínimo conta por filial", async () => {
    const sim = new OmieSimulator();
    sim.accounts.set("KEY-A", {
      appSecret: "sec-a", receivables: [], payables: [],
      salesOrders: [
        salesOrder(1, { total: 1000.5, cabecalho: at(1), infoCadastro: fat(TODAY) }),
        salesOrder(2, { total: 2000, cabecalho: at(1), infoCadastro: fat(TODAY) }),
        salesOrder(3, { total: 500, cabecalho: at(2), infoCadastro: fat(TODAY) }),
        salesOrder(4, { total: 9999, cabecalho: { ...at(1), etapa: "00" }, infoCadastro: fat(TODAY, { cFaturado: "N", dFat: undefined, hFat: undefined }) }), // orçamento
        salesOrder(5, { total: 7777, cabecalho: { ...at(2), etapa: "20" }, infoCadastro: fat(TODAY, { cFaturado: "N", dFat: undefined, hFat: undefined }) }), // aberto
        salesOrder(6, { total: 6666, cabecalho: at(2), infoCadastro: fat(TODAY, { cCancelado: "S" }) }), // cancelado
        salesOrder(7, { total: 3333, cabecalho: at(1), infoCadastro: fat(LAST_MONTH) }), // mês anterior
        salesOrder(8, { total: 4444, cabecalho: at(3), infoCadastro: fat(TODAY), itens: [orderItem(1)] }), // filial sem mapa
      ],
      stock: [
        { ...stockPosition(1, { nSaldo: 1 }), codigo_empresa: 1 },
        { ...stockPosition(2, { nSaldo: 2 }), codigo_empresa: 1 },
        { ...stockPosition(3, { nSaldo: 50 }), codigo_empresa: 1 },
        { ...stockPosition(4, { nSaldo: 0, estoque_minimo: 0 }), codigo_empresa: 2 }, // sem estoque e sem mínimo: não conta
        { ...stockPosition(5, { nSaldo: 4 }), codigo_empresa: 2 },
      ],
    });
    await store.save(A, "vault:oss", { kind: "api_key_pair", appKey: "KEY-A", appSecret: "sec-a" });
    // Os fatos de pedido e de estoque trazem a filial em lugares diferentes; a fonte aponta um campo só, então cada fluxo tem a sua fonte.
    const orders = await sources.create(A, {
      name: "Omie pedidos", sourceType: "omie", authoritativeDomain: "sales", syncMode: "pull", secretRef: "vault:oss",
      config: { streams: ["sales_order"], unitRefField: "cabecalho.codigo_empresa", unitMap: { "1": curitiba, "2": manaus } },
    });
    const stock = await sources.create(A, {
      name: "Omie estoque", sourceType: "omie", authoritativeDomain: "inventory", syncMode: "pull", secretRef: "vault:oss",
      config: { streams: ["stock"], unitRefField: "codigo_empresa", unitMap: { "1": curitiba, "2": manaus } },
    });
    sourceId = orders.id;
    const runtime = runtimeFor(sim);
    expect(await runtime.syncPull(ctx(A), { sourceId: orders.id, idempotencyKey: "oss-1" })).toMatchObject({ status: "completed" });
    expect(await runtime.syncPull(ctx(A), { sourceId: stock.id, idempotencyKey: "oss-2" })).toMatchObject({ status: "completed", ingested: 5 });

    const amount = (unit: string) => metricStore.latestValue(A, "sales.orders.invoiced_amount", undefined, unit);
    expect(await amount(curitiba)).toMatchObject({ value: "3000.5", unit: "currency", currency: "BRL" }); // 1000.50 + 2000; o do mês anterior fica de fora
    expect(await amount(manaus)).toMatchObject({ value: "500" }); // aberto, orçamento e cancelado fora
    expect(await metricStore.latestValue(A, "sales.orders.invoiced_count", undefined, curitiba)).toMatchObject({ value: "2" });
    expect(await metricStore.latestValue(A, "sales.orders.invoiced_amount", undefined, curitiba, "previous")).toMatchObject({ value: "3333" });
    // Pedido de filial sem mapa entra sem unidade (nunca atribuído por palpite): só aparece no nível da empresa.
    expect(await metricStore.latestValue(A, "sales.orders.invoiced_amount")).toMatchObject({ value: "4444" });

    expect(await metricStore.latestValue(A, "inventory.below_minimum.count", undefined, curitiba)).toMatchObject({ value: "2" });
    expect(await metricStore.latestValue(A, "inventory.below_minimum.count", undefined, manaus)).toMatchObject({ value: "1" });
    // Outra empresa não vê nada.
    expect(await metricStore.latestValue(B, "sales.orders.invoiced_amount", undefined, curitiba)).toBeNull();
  });

  it("o ERP cancela um pedido já faturado: a versão nova substitui a antiga e a venda sai do número", async () => {
    const sim = new OmieSimulator();
    sim.accounts.set("KEY-A", {
      appSecret: "sec-a", receivables: [], payables: [], stock: [],
      salesOrders: [salesOrder(2, { total: 2000, cabecalho: at(1), infoCadastro: fat(TODAY, { cCancelado: "S", dAlt: TODAY, hAlt: "18:00:00" }) })],
    });
    await runtimeFor(sim).syncPull(ctx(A), { sourceId, idempotencyKey: "oss-3" });
    expect(await metricStore.latestValue(A, "sales.orders.invoiced_amount", undefined, curitiba)).toMatchObject({ value: "1000.5" });
    expect(await metricStore.latestValue(A, "sales.orders.invoiced_count", undefined, curitiba)).toMatchObject({ value: "1" });
  });

  it("as linhas dos pedidos ficam guardadas com produto, quantidade e valor, prontas para um ranking por produto futuro", async () => {
    const items = await db.select().from(canonicalFacts).where(eq(canonicalFacts.tenantId, A));
    const lines = items.filter((f) => f.factType === "sales.order_item");
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(lines.find((f) => f.externalId === "order:1:item:5001")?.payload).toMatchObject({ productRef: "301", quantity: "2", amountMinor: 25000, orderRef: "1", status: "invoiced" });
    // O cancelamento do pedido 2 também chegou nas linhas dele.
    expect(lines.find((f) => f.externalId === "order:2:item:5001")?.payload).toMatchObject({ status: "cancelled" });
  });
});
