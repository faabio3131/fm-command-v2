import type { ConnectorFact } from "@/domain/integration/contracts";
import { toMinorUnits } from "@/infrastructure/connectors/money";

/**
 * Tradução dos registros do Omie para fatos canônicos. Regra do produto: o que
 * o Omie não entregou fica ausente e listado em `unavailable`; nunca vira zero.
 * Os nomes de campo seguem a documentação pública do Omie e ainda NÃO foram
 * conferidos contra uma conta real (ver docs/medicoes/CONECTORES-8E).
 */
export type OmieStream = "receivable" | "payable" | "sales_order" | "stock";

/** Fluxos de finanças: ligados por padrão. Vendas e estoque só entram se a fonte pedir (`config.streams`). */
export const OMIE_DEFAULT_STREAMS: readonly OmieStream[] = ["receivable", "payable"];
export const OMIE_ALL_STREAMS: readonly OmieStream[] = ["receivable", "payable", "sales_order", "stock"];

export interface OmieStreamSpec {
  readonly path: string;
  readonly method: string;
  readonly listKey: string;
  readonly factType: string;
  /** Nomes dos parâmetros de paginação e da contagem de páginas na resposta (variam por serviço). */
  readonly pageParam: string;
  readonly sizeParam: string;
  readonly totalPagesKey: string;
  /** Parâmetros fixos do fluxo. */
  readonly fixedParams: Readonly<Record<string, unknown>>;
  /** Aceita leitura só do que mudou desde uma data. Posição de estoque é sempre lida inteira. */
  readonly incremental: boolean;
}

/*
 * ATENÇÃO (etapa 8I, 17/10/2026): os fluxos `sales_order` e `stock` seguem o que a Central de Ajuda
 * e o portal do Omie mostram (endereços e a estrutura do pedido enviado pela API), mas os NOMES dos
 * métodos de listagem (ListarPedidos, ListarPosEstoque) e dos campos de resposta usados aqui
 * NÃO foram conferidos: as páginas de documentação por método não podem ser lidas por robô.
 * Só uma conta de teste do Omie, ou a lista de métodos copiada do portal, confirma. Até lá, vale só
 * contra o simulador.
 */
export const OMIE_STREAMS: Record<OmieStream, OmieStreamSpec> = {
  receivable: {
    path: "financeiro/contareceber",
    method: "ListarContasReceber",
    listKey: "conta_receber_cadastro",
    factType: "finance.receivable",
    pageParam: "pagina", sizeParam: "registros_por_pagina", totalPagesKey: "total_de_paginas",
    fixedParams: { apenas_importado_api: "N" }, incremental: true,
  },
  payable: {
    path: "financeiro/contapagar",
    method: "ListarContasPagar",
    listKey: "conta_pagar_cadastro",
    factType: "finance.payable",
    pageParam: "pagina", sizeParam: "registros_por_pagina", totalPagesKey: "total_de_paginas",
    fixedParams: { apenas_importado_api: "N" }, incremental: true,
  },
  sales_order: {
    path: "produtos/pedido",
    method: "ListarPedidos",
    listKey: "pedido_venda_produto",
    factType: "sales.order",
    pageParam: "pagina", sizeParam: "registros_por_pagina", totalPagesKey: "total_de_paginas",
    fixedParams: { apenas_importado_api: "N" }, incremental: true,
  },
  stock: {
    path: "estoque/consulta",
    method: "ListarPosEstoque",
    listKey: "produtos",
    factType: "inventory.position",
    pageParam: "nPagina", sizeParam: "nRegPorPagina", totalPagesKey: "nTotPaginas",
    fixedParams: { cExibeTodos: "S" }, incremental: false,
  },
};

export const OMIE_MAPPING_VERSION = "omie.v1";

export interface OmieMappingOptions {
  readonly currency: string;
  /** Fuso do Omie em minutos em relação a UTC (Brasil: -180). */
  readonly utcOffsetMinutes: number;
  /** Campo do registro que identifica a unidade (filial/departamento), se o cliente usa. */
  readonly unitRefField?: string;
  readonly retrievedAt: Date;
}

/** Campo aninhado por caminho com pontos ("cabecalho.codigo_empresa"). Só chaves próprias e de nome simples. */
export function getPath(record: Record<string, unknown>, path: string): unknown {
  let current: unknown = record;
  for (const key of path.split(".")) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** "dd/mm/yyyy" (+ "hh:mm:ss") no fuso do Omie -> Date em UTC. Inválido -> undefined. */
export function parseOmieDate(date: unknown, time: unknown, utcOffsetMinutes: number): Date | undefined {
  if (typeof date !== "string") return undefined;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  if (!m) return undefined;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let h = 0, mi = 0, s = 0;
  if (typeof time === "string" && time.trim()) {
    const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
    if (!t) return undefined;
    [h, mi, s] = [Number(t[1]), Number(t[2]), Number(t[3] ?? 0)];
  }
  const utc = Date.UTC(year, month - 1, day, h, mi, s) - utcOffsetMinutes * 60_000;
  const result = new Date(utc);
  // Rejeita datas impossíveis (31/02): o JS as rolaria para março.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return undefined;
  return Number.isNaN(result.getTime()) ? undefined : result;
}

function isoDay(date: Date | undefined): string | undefined {
  return date ? date.toISOString().slice(0, 10) : undefined;
}

export { toMinorUnits };

function mapStatus(raw: unknown): "open" | "overdue" | "settled" | "cancelled" | undefined {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (["PAGO", "RECEBIDO", "LIQUIDADO"].includes(v)) return "settled";
  if (v === "CANCELADO") return "cancelled";
  if (v === "ATRASADO") return "overdue";
  if (["A VENCER", "VENCE HOJE", "EM ABERTO"].includes(v)) return "open";
  return undefined;
}

export function mapOmieRecord(
  stream: "receivable" | "payable",
  record: unknown,
  options: OmieMappingOptions,
): ConnectorFact | undefined {
  if (!record || typeof record !== "object" || Array.isArray(record)) return undefined;
  const r = record as Record<string, unknown>;
  const externalId = text(r.codigo_lancamento_omie);
  if (!externalId) return undefined; // sem identificador não há como deduplicar

  const unavailable: string[] = [];
  const payload: Record<string, unknown> = { currency: options.currency };

  const amount = toMinorUnits(r.valor_documento, options.currency);
  if (amount === undefined) unavailable.push("amountMinor");
  else payload.amountMinor = amount;

  const due = isoDay(parseOmieDate(r.data_vencimento, undefined, 0));
  if (!due) unavailable.push("dueDate");
  else payload.dueDate = due;

  const issue = parseOmieDate(r.data_emissao, undefined, 0);
  if (!issue) unavailable.push("issueDate");
  else payload.issueDate = isoDay(issue);

  const status = mapStatus(r.status_titulo);
  if (!status) unavailable.push("status");
  else payload.status = status;
  const sourceStatus = text(r.status_titulo);
  if (sourceStatus) payload.sourceStatus = sourceStatus;

  const counterparty = text(r.codigo_cliente_fornecedor);
  if (!counterparty) unavailable.push("counterpartyRef");
  else payload.counterpartyRef = counterparty;

  const info = r.info && typeof r.info === "object" && !Array.isArray(r.info) ? (r.info as Record<string, unknown>) : {};
  const changed = parseOmieDate(info.dAlt, info.hAlt, options.utcOffsetMinutes);
  let sourceTimestamp: Date;
  if (changed) {
    sourceTimestamp = changed;
    payload.timestampBasis = "changed_at";
  } else {
    // Sem data de alteração não há como saber qual versão é a mais nova: vale a leitura mais recente.
    sourceTimestamp = options.retrievedAt;
    payload.timestampBasis = "retrieved_at";
  }
  if (unavailable.length) payload.unavailable = unavailable;

  const unitRef = options.unitRefField ? text(getPath(r, options.unitRefField)) : undefined;
  // O Omie numera receber e pagar separadamente: o fluxo entra no identificador para não colidirem.
  return { externalId: `${stream}:${externalId}`, factType: OMIE_STREAMS[stream].factType, payload, sourceTimestamp, unitRef };
}

// ---------------------------------------------------------------------------------------------
// Vendas (pedido e itens) e estoque. Ver o aviso sobre campos não conferidos acima.
// ---------------------------------------------------------------------------------------------

export type OrderStatus = "quote" | "open" | "invoiced" | "cancelled";

/**
 * Orçamento (etapa "00") não é venda. Cancelado vence faturado. Sem sinal claro, o status fica
 * ausente: o pedido entra no Command, mas nenhuma métrica o conta.
 */
function mapOrderStatus(header: Record<string, unknown>, info: Record<string, unknown>): OrderStatus | undefined {
  const flag = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : "");
  if (flag(info.cCancelado) === "S") return "cancelled";
  const stage = text(header.etapa);
  if (stage === "00") return "quote";
  if (flag(info.cFaturado) === "S") return "invoiced";
  if (flag(info.cFaturado) === "N" && stage !== undefined) return "open";
  return undefined;
}

function decimalText(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d+([.,]\d+)?$/.test(value.trim())) return value.trim().replace(",", ".");
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const t = Number(value.toFixed(6)).toString();
  return /^\d+(\.\d+)?$/.test(t) ? t : undefined;
}

/**
 * Pedido de venda do Omie -> 1 fato `sales.order` (cabeçalho) + 1 fato `sales.order_item` por linha.
 *
 * Data do fato (é a data que o motor usa para escolher o período):
 *  - faturado: a data de faturamento. Sem ela, o status fica ausente: nunca se coloca a venda num mês por palpite.
 *  - qualquer outro status: a data mais nova que o pedido conhece (inclusão, faturamento, alteração). Assim um
 *    cancelamento depois do faturamento tem data igual ou maior e substitui a versão faturada (a origem mais velha
 *    nunca sobrescreve a mais nova).
 * Item removido de um pedido já lido NÃO some: o modelo de fatos não apaga. Está registrado como limite conhecido.
 */
export function mapOmieSalesOrder(record: unknown, options: OmieMappingOptions): ConnectorFact[] {
  if (!record || typeof record !== "object" || Array.isArray(record)) return [];
  const r = record as Record<string, unknown>;
  const header = obj(r.cabecalho);
  const info = obj(r.infoCadastro);
  const orderId = text(header.codigo_pedido);
  if (!orderId) return [];

  const unavailable: string[] = [];
  const payload: Record<string, unknown> = { currency: options.currency };
  const sourceStatus = text(header.etapa);
  if (sourceStatus) payload.sourceStage = sourceStatus;

  const amount = toMinorUnits(obj(r.total_pedido).valor_total_pedido, options.currency);
  if (amount === undefined) unavailable.push("amountMinor");
  else payload.amountMinor = amount;

  let status = mapOrderStatus(header, info);
  const invoicedAt = parseOmieDate(info.dFat, info.hFat, options.utcOffsetMinutes);
  const createdAt = parseOmieDate(info.dInc, info.hInc, options.utcOffsetMinutes);
  const changedAt = parseOmieDate(info.dAlt, info.hAlt, options.utcOffsetMinutes);

  let sourceTimestamp: Date;
  if (status === "invoiced") {
    if (invoicedAt) {
      sourceTimestamp = invoicedAt;
      payload.timestampBasis = "invoiced_at";
      payload.invoicedAt = invoicedAt.toISOString();
    } else {
      unavailable.push("invoicedAt");
      payload.statusReason = "invoiced_without_date";
      status = undefined;
      sourceTimestamp = [createdAt, changedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? options.retrievedAt;
      payload.timestampBasis = createdAt || changedAt ? "latest_known" : "retrieved_at";
    }
  } else {
    const known = [createdAt, invoicedAt, changedAt].filter((d): d is Date => !!d);
    if (known.length) {
      sourceTimestamp = new Date(Math.max(...known.map((d) => d.getTime())));
      payload.timestampBasis = "latest_known";
    } else {
      sourceTimestamp = options.retrievedAt;
      payload.timestampBasis = "retrieved_at";
    }
  }
  if (status === undefined && !unavailable.includes("invoicedAt")) unavailable.push("status");
  if (status) payload.status = status;

  const customer = text(header.codigo_cliente);
  if (customer) payload.customerRef = customer; else unavailable.push("customerRef");
  const number = text(header.numero_pedido);
  if (number) payload.orderNumber = number;

  const lines = Array.isArray(r.det) ? r.det : [];
  const declared = Number(header.quantidade_itens);
  payload.itemCount = lines.length;
  // O Omie declara a quantidade de itens no cabeçalho; divergência é sinal de leitura incompleta, não é corrigida.
  if (Number.isInteger(declared) && declared !== lines.length) payload.itemCountDeclared = declared;
  if (unavailable.length) payload.unavailable = unavailable;

  const unitRef = options.unitRefField ? text(getPath(r, options.unitRefField)) : undefined;
  const facts: ConnectorFact[] = [
    { externalId: `order:${orderId}`, factType: "sales.order", payload, sourceTimestamp, unitRef },
  ];

  lines.forEach((line, index) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) return;
    const l = line as Record<string, unknown>;
    const product = obj(l.produto);
    const lineId = text(obj(l.ide).codigo_item) ?? String(index + 1);
    const itemUnavailable: string[] = [];
    const item: Record<string, unknown> = { currency: options.currency, orderRef: orderId };
    if (status) item.status = status;
    else itemUnavailable.push("status");
    item.timestampBasis = payload.timestampBasis;

    const productRef = text(product.codigo_produto);
    if (productRef) item.productRef = productRef; else itemUnavailable.push("productRef");
    const description = text(product.descricao);
    if (description) item.description = description;
    const quantity = decimalText(product.quantidade);
    if (quantity !== undefined) item.quantity = quantity; else itemUnavailable.push("quantity");
    const unitAmount = toMinorUnits(product.valor_unitario, options.currency);
    if (unitAmount !== undefined) item.unitAmountMinor = unitAmount; else itemUnavailable.push("unitAmountMinor");
    // O total do item vem da origem; não é recalculado aqui (quantidade fracionária x preço exigiria arredondar).
    const total = toMinorUnits(product.valor_total ?? product.valor_mercadoria, options.currency);
    if (total !== undefined) item.amountMinor = total; else itemUnavailable.push("amountMinor");
    if (itemUnavailable.length) item.unavailable = itemUnavailable;
    facts.push({ externalId: `order:${orderId}:item:${lineId}`, factType: "sales.order_item", payload: item, sourceTimestamp, unitRef });
  });
  return facts;
}

export type StockStatus = "ok" | "below_minimum" | "out_of_stock" | "no_minimum";

/**
 * Posição de estoque de um produto -> fato `inventory.position`. A posição é uma foto: a data do fato é a da leitura.
 * Sem estoque mínimo informado (ou zero) o produto nunca é dado como "abaixo do mínimo".
 */
export function mapOmieStockPosition(record: unknown, options: OmieMappingOptions): ConnectorFact | undefined {
  if (!record || typeof record !== "object" || Array.isArray(record)) return undefined;
  const r = record as Record<string, unknown>;
  const productId = text(r.nCodProd);
  if (!productId) return undefined;

  const unavailable: string[] = [];
  const payload: Record<string, unknown> = { currency: options.currency, productRef: productId, timestampBasis: "retrieved_at" };
  const code = text(r.cCodigo);
  if (code) payload.productCode = code;
  const description = text(r.cDescricao);
  if (description) payload.description = description;

  const balance = typeof r.nSaldo === "number" && Number.isFinite(r.nSaldo) ? r.nSaldo : undefined;
  if (balance === undefined) unavailable.push("quantity");
  else payload.quantity = String(Number(balance.toFixed(6)));
  const rawMin = r.estoque_minimo ?? r.nEstoqueMinimo;
  const minimum = typeof rawMin === "number" && Number.isFinite(rawMin) && rawMin >= 0 ? rawMin : undefined;
  if (minimum === undefined) unavailable.push("minimum");
  else payload.minimum = String(Number(minimum.toFixed(6)));
  const cost = toMinorUnits(r.nCMC, options.currency);
  if (cost !== undefined) payload.unitCostMinor = cost; else unavailable.push("unitCostMinor");

  let status: StockStatus | undefined;
  if (balance !== undefined) {
    if (minimum !== undefined && minimum > 0 && balance < minimum) status = "below_minimum";
    else if (balance <= 0) status = "out_of_stock";
    else status = minimum !== undefined && minimum > 0 ? "ok" : "no_minimum";
  } else {
    unavailable.push("status");
  }
  if (status) payload.status = status;
  if (unavailable.length) payload.unavailable = unavailable;

  const unitRef = options.unitRefField ? text(getPath(r, options.unitRefField)) : undefined;
  return { externalId: `stock:${productId}`, factType: "inventory.position", payload, sourceTimestamp: options.retrievedAt, unitRef };
}

/** Um registro do Omie -> zero, um ou vários fatos, conforme o fluxo. */
export function mapOmieFacts(stream: OmieStream, record: unknown, options: OmieMappingOptions): ConnectorFact[] {
  if (stream === "sales_order") return mapOmieSalesOrder(record, options);
  if (stream === "stock") {
    const fact = mapOmieStockPosition(record, options);
    return fact ? [fact] : [];
  }
  const fact = mapOmieRecord(stream, record, options);
  return fact ? [fact] : [];
}
