import { describe, expect, it } from "vitest";
import { RateLimiter, type Clock } from "@/application/integration/rate-limiter";
import { ConnectorConfigError, type SourceDefinition } from "@/domain/integration/contracts";
import { OmieClient } from "@/infrastructure/connectors/omie/omie-client";
import { OmieConnector } from "@/infrastructure/connectors/omie/omie-connector";
import { getPath, mapOmieSalesOrder, mapOmieStockPosition, type OmieMappingOptions } from "@/infrastructure/connectors/omie/omie-mapping";
import { computeMetric } from "@/domain/metrics/metric-engine";
import { getMetricDefinition } from "@/domain/metrics/registry";
import { InMemoryCredentialStore, OmieSimulator, orderItem, receivable, salesOrder, stockPosition } from "./support/omie-simulator";

const RETRIEVED = new Date("2026-10-17T15:00:00Z");
const options: OmieMappingOptions = { currency: "BRL", utcOffsetMinutes: -180, retrievedAt: RETRIEVED };

describe("pedido de venda do Omie → fatos (8I)", () => {
  it("pedido faturado vira um fato de cabeçalho e um por item, com data de faturamento e centavos exatos", () => {
    const facts = mapOmieSalesOrder(salesOrder(1, { total: 250.1, itens: [orderItem(1), orderItem(2, { quantidade: 1.5, valor_unitario: 10.05, valor_total: 15.08 })] }), options);
    expect(facts.map((f) => [f.externalId, f.factType])).toEqual([
      ["order:1", "sales.order"], ["order:1:item:5001", "sales.order_item"], ["order:1:item:5002", "sales.order_item"],
    ]);
    const [header, first, second] = facts;
    expect(header.payload).toMatchObject({ status: "invoiced", amountMinor: 25010, currency: "BRL", timestampBasis: "invoiced_at", itemCount: 2, customerRef: "701" });
    expect(header.sourceTimestamp.toISOString()).toBe("2026-10-05T17:30:00.000Z"); // 14:30 em -03:00
    expect(first.payload).toMatchObject({ orderRef: "1", productRef: "301", quantity: "2", unitAmountMinor: 12500, amountMinor: 25000, status: "invoiced" });
    expect(second.payload).toMatchObject({ quantity: "1.5", unitAmountMinor: 1005, amountMinor: 1508 });
    expect(first.sourceTimestamp).toEqual(header.sourceTimestamp);
  });

  it("orçamento (etapa 00) e pedido em aberto não são venda faturada; cancelado vence faturado", () => {
    const quote = mapOmieSalesOrder(salesOrder(2, { cabecalho: { etapa: "00" }, infoCadastro: { cFaturado: "N", dFat: undefined } }), options)[0];
    expect(quote.payload.status).toBe("quote");
    const open = mapOmieSalesOrder(salesOrder(3, { cabecalho: { etapa: "20" }, infoCadastro: { cFaturado: "N", dFat: undefined } }), options)[0];
    expect(open.payload.status).toBe("open");
    const cancelled = mapOmieSalesOrder(salesOrder(4, { infoCadastro: { cCancelado: "S" } }), options)[0];
    expect(cancelled.payload.status).toBe("cancelled");
    // Um cancelamento depois do faturamento não pode ter data menor que a versão faturada (a mais velha nunca sobrescreve a mais nova).
    const invoiced = mapOmieSalesOrder(salesOrder(4), options)[0];
    expect(cancelled.sourceTimestamp.getTime()).toBeGreaterThanOrEqual(invoiced.sourceTimestamp.getTime());
  });

  it("faturado sem data de faturamento: o status fica ausente e o pedido não entra em nenhuma métrica (nunca num mês por palpite)", () => {
    const [header, item] = mapOmieSalesOrder(salesOrder(5, { infoCadastro: { dFat: undefined, hFat: undefined } }), options);
    expect(header.payload.status).toBeUndefined();
    expect(header.payload.unavailable).toContain("invoicedAt");
    expect(header.payload.statusReason).toBe("invoiced_without_date");
    expect(item.payload.status).toBeUndefined();
    const metric = computeMetric(getMetricDefinition("sales.orders.invoiced_amount")!, [{ id: "f", externalId: header.externalId, factType: "sales.order", payload: header.payload, sourceTimestamp: header.sourceTimestamp, provenanceRef: "f" }]);
    expect(metric.status).toBe("missing");
  });

  it("campo ausente fica indisponível, nunca zero; sem código do pedido o registro é descartado", () => {
    const [header, item] = mapOmieSalesOrder({
      cabecalho: { codigo_pedido: 9, etapa: "60" }, infoCadastro: { cFaturado: "S", dFat: "03/10/2026" }, det: [{ produto: { descricao: "Sem código" } }],
    }, options);
    expect(header.payload.amountMinor).toBeUndefined();
    expect(header.payload.unavailable).toEqual(expect.arrayContaining(["amountMinor", "customerRef"]));
    expect(item.externalId).toBe("order:9:item:1"); // sem id do item, vale a posição
    expect(item.payload.unavailable).toEqual(expect.arrayContaining(["productRef", "quantity", "unitAmountMinor", "amountMinor"]));
    expect(item.payload.quantity).toBeUndefined();
    expect(mapOmieSalesOrder({ cabecalho: {} }, options)).toEqual([]);
    expect(mapOmieSalesOrder(null, options)).toEqual([]);
    expect(mapOmieSalesOrder([], options)).toEqual([]);
  });

  it("pedido sem valor deixa a venda do período indisponível (nunca soma parcial)", () => {
    const def = getMetricDefinition("sales.orders.invoiced_amount")!;
    const fact = (id: number, total?: number) => {
      const h = mapOmieSalesOrder(salesOrder(id, { total }), options)[0];
      return { id: `f${id}`, externalId: h.externalId, factType: h.factType, payload: h.payload, sourceTimestamp: h.sourceTimestamp, provenanceRef: `f${id}` };
    };
    const ok = computeMetric(def, [fact(1, 100), fact(2, 50.25)]);
    expect(ok).toMatchObject({ status: "available", value: "150.25", currency: "BRL" });
    const withHole = { ...fact(3, 10), payload: { ...fact(3, 10).payload, amountMinor: undefined } };
    expect(computeMetric(def, [fact(1, 100), withHole]).status).toBe("missing");
    const count = computeMetric(getMetricDefinition("sales.orders.invoiced_count")!, [fact(1, 100), fact(2, 50)]);
    expect(count).toMatchObject({ status: "available", value: "2" });
  });

  it("quantidade declarada diferente das linhas lidas é registrada, não corrigida", () => {
    const [header] = mapOmieSalesOrder(salesOrder(6, { cabecalho: { quantidade_itens: 3 }, itens: [orderItem(1)] }), options);
    expect(header.payload).toMatchObject({ itemCount: 1, itemCountDeclared: 3 });
  });

  it("a filial vem de um campo aninhado configurado; caminho inválido ou inexistente não atribui filial", () => {
    const record = salesOrder(7, { cabecalho: { codigo_empresa: 42 } });
    expect(mapOmieSalesOrder(record, { ...options, unitRefField: "cabecalho.codigo_empresa" }).map((f) => f.unitRef)).toEqual(["42", "42"]);
    expect(mapOmieSalesOrder(record, { ...options, unitRefField: "cabecalho.nao_existe" })[0].unitRef).toBeUndefined();
    expect(getPath({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(getPath({ a: { b: 1 } }, "a.__proto__")).toBeUndefined();
    expect(getPath({ a: 1 }, "a.constructor")).toBeUndefined();
    expect(getPath({ a: 1 }, "a..b")).toBeUndefined();
  });
});

describe("posição de estoque do Omie → fatos (8I)", () => {
  it("abaixo do mínimo, sem estoque, normal e sem mínimo cadastrado", () => {
    const status = (over: Record<string, unknown>) => mapOmieStockPosition(stockPosition(1, over), options)?.payload.status;
    expect(status({ nSaldo: 3, estoque_minimo: 5 })).toBe("below_minimum");
    expect(status({ nSaldo: 5, estoque_minimo: 5 })).toBe("ok");
    expect(status({ nSaldo: 0, estoque_minimo: 0 })).toBe("out_of_stock");
    expect(status({ nSaldo: 0, estoque_minimo: 5 })).toBe("below_minimum");
    expect(status({ nSaldo: 8, estoque_minimo: undefined })).toBe("no_minimum");
    expect(status({ nSaldo: 8, estoque_minimo: 0 })).toBe("no_minimum");
  });

  it("sem saldo o produto não tem status e fica fora da métrica; custo e mínimo ausentes ficam indisponíveis", () => {
    const fact = mapOmieStockPosition(stockPosition(2, { nSaldo: undefined, estoque_minimo: undefined, nCMC: undefined }), options)!;
    expect(fact.payload.status).toBeUndefined();
    expect(fact.payload.unavailable).toEqual(expect.arrayContaining(["quantity", "minimum", "unitCostMinor", "status"]));
    expect(fact.externalId).toBe("stock:2");
    expect(fact.sourceTimestamp).toEqual(RETRIEVED);
    expect(mapOmieStockPosition({ cCodigo: "X" }, options)).toBeUndefined();
  });

  it("a métrica conta só os produtos abaixo do mínimo", () => {
    const def = getMetricDefinition("inventory.below_minimum.count")!;
    const facts = [stockPosition(1, { nSaldo: 1 }), stockPosition(2), stockPosition(3, { nSaldo: 0 }), stockPosition(4, { estoque_minimo: undefined })]
      .map((r) => mapOmieStockPosition(r, options)!)
      .map((f) => ({ id: f.externalId, externalId: f.externalId, factType: f.factType, payload: f.payload, sourceTimestamp: f.sourceTimestamp, provenanceRef: f.externalId }));
    expect(computeMetric(def, facts)).toMatchObject({ status: "available", value: "2" });
  });
});

describe("conector Omie com vendas e estoque (8I)", () => {
  const fakeClock = (): Clock => { let t = Date.parse("2026-10-17T15:00:00Z"); return { now: () => t, sleep: async (ms) => { t += ms; } }; };
  function setup(config: Record<string, unknown> = {}) {
    const sim = new OmieSimulator();
    sim.accounts.set("KEY", {
      appSecret: "sec", receivables: [receivable(1)], payables: [],
      salesOrders: [salesOrder(1), salesOrder(2, { cabecalho: { etapa: "00" }, infoCadastro: { cFaturado: "N", dFat: undefined } })],
      stock: [stockPosition(1, { nSaldo: 1 }), stockPosition(2)],
    });
    const creds = new InMemoryCredentialStore();
    creds.set("t", "vault:o", { kind: "api_key_pair", appKey: "KEY", appSecret: "sec" });
    const clock = fakeClock();
    const connector = new OmieConnector(new OmieClient(sim, new RateLimiter(clock)), creds, clock);
    const source: SourceDefinition = { id: "s", tenantId: "t", name: "Omie", sourceType: "omie", authoritativeDomain: "finance", status: "configured", syncMode: "pull", config, mappingVersion: "omie.v1", secretRef: "vault:o" };
    const ctx = { tenantId: "t", correlationId: "c", timeoutMs: 5000 };
    return { sim, connector, source, ctx };
  }

  async function cycle(connector: OmieConnector, ctx: { tenantId: string; correlationId: string; timeoutMs: number }, source: SourceDefinition) {
    const types: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 12; i += 1) {
      const result = await connector.pull(ctx, source, cursor);
      types.push(...result.facts.map((f) => f.factType));
      cursor = result.nextCursor;
      if (cursor && JSON.parse(cursor).since) break; // ciclo completo
    }
    return { types, cursor };
  }

  it("por padrão só lê finanças: nenhuma chamada aos serviços de vendas e estoque", async () => {
    const { sim, connector, source, ctx } = setup();
    const { types } = await cycle(connector, ctx, source);
    expect(new Set(types)).toEqual(new Set(["finance.receivable"]));
    expect(sim.calls.map((c) => c.call)).not.toContain("ListarPedidos");
    expect(sim.calls.map((c) => c.call)).not.toContain("ListarPosEstoque");
  });

  it("com os fluxos pedidos, lê pedidos e estoque com os nomes de parâmetro de cada serviço", async () => {
    const { sim, connector, source, ctx } = setup({ streams: ["stock", "sales_order"] });
    const { types, cursor } = await cycle(connector, ctx, source);
    expect(types.filter((t) => t === "sales.order")).toHaveLength(2);
    expect(types.filter((t) => t === "sales.order_item")).toHaveLength(2);
    expect(types.filter((t) => t === "inventory.position")).toHaveLength(2);
    expect(types).not.toContain("finance.receivable");
    const stockCall = sim.calls.find((c) => c.call === "ListarPosEstoque")!;
    expect(stockCall.param).toMatchObject({ nPagina: 1, nRegPorPagina: 100, cExibeTodos: "S", dDataPosicao: "17/10/2026" });
    const orderCall = sim.calls.find((c) => c.call === "ListarPedidos")!;
    expect(orderCall.param).toMatchObject({ pagina: 1, registros_por_pagina: 100 });
    // Ordem fixa (pedidos antes do estoque, qualquer que seja a ordem da configuração) e ciclo seguinte incremental.
    expect(sim.calls.map((c) => c.call)).toEqual(["ListarPedidos", "ListarPosEstoque"]);
    expect(JSON.parse(cursor!)).toMatchObject({ s: "sales_order", p: 1, since: "2026-10-17" });
  });

  it("no ciclo incremental os pedidos usam o filtro de alteração e o estoque continua sendo lido inteiro", async () => {
    const { sim, connector, source, ctx } = setup({ streams: ["sales_order", "stock"] });
    let r = await connector.pull(ctx, source, JSON.stringify({ s: "sales_order", p: 1, since: "2026-10-10" }));
    expect(sim.calls[0].param).toMatchObject({ filtrar_apenas_alteracao: "S", filtrar_por_data_de: "09/10/2026" });
    r = await connector.pull(ctx, source, JSON.stringify({ s: "stock", p: 1, since: "2026-10-10" }));
    expect(sim.calls[1].param.filtrar_apenas_alteracao).toBeUndefined();
    expect(sim.calls[1].param.filtrar_por_data_de).toBeUndefined();
    expect(r.facts).toHaveLength(2);
  });

  it("pagina o estoque com a contagem de páginas própria do serviço", async () => {
    const { sim, connector, source, ctx } = setup({ streams: ["stock"] });
    sim.accounts.get("KEY")!.stock = Array.from({ length: 150 }, (_, i) => stockPosition(i + 1));
    const first = await connector.pull(ctx, source);
    expect(first.facts).toHaveLength(100);
    expect(JSON.parse(first.nextCursor!)).toMatchObject({ s: "stock", p: 2 });
    const second = await connector.pull(ctx, source, first.nextCursor);
    expect(second.facts).toHaveLength(50);
    expect(JSON.parse(second.nextCursor!)).toMatchObject({ s: "stock", p: 1, since: "2026-10-17" });
  });

  it("fluxo desconhecido ou lista vazia na configuração é erro de configuração; cursor de fluxo desligado recomeça pelo primeiro ligado", async () => {
    await expect(setup({ streams: ["inexistente"] }).connector.pull(setup().ctx, setup({ streams: ["inexistente"] }).source)).rejects.toBeInstanceOf(ConnectorConfigError);
    await expect(setup({ streams: [] }).connector.pull(setup().ctx, setup({ streams: [] }).source)).rejects.toBeInstanceOf(ConnectorConfigError);
    const { connector, source, ctx } = setup({ streams: ["sales_order"] });
    const r = await connector.pull(ctx, source, JSON.stringify({ s: "payable", p: 1 }));
    expect(r.facts.every((f) => f.factType.startsWith("sales."))).toBe(true);
  });

  it("registro sem identificador é contado como descartado", async () => {
    const { sim, connector, source, ctx } = setup({ streams: ["sales_order"] });
    sim.accounts.get("KEY")!.salesOrders = [salesOrder(1), { cabecalho: {} }];
    const r = await connector.pull(ctx, source);
    expect(r.facts).toHaveLength(2);
    expect(r.skipped).toBe(1);
  });
});
