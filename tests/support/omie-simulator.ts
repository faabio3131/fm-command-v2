import type { JsonHttpResponse, JsonHttpTransport } from "@/infrastructure/connectors/http-json-transport";
import { TransportError } from "@/infrastructure/connectors/http-json-transport";
import type { CredentialStore, ConnectorCredential } from "@/domain/integration/credentials";
import { CredentialNotFoundError } from "@/domain/integration/credentials";

/**
 * Simulador do Omie para testes. Segue a documentação pública (POST JSON com
 * call/app_key/app_secret/param, 100 registros por página, 425 ao exceder).
 * Os textos de erro (`faultstring`) são suposições: só a conta de teste real
 * dirá os textos exatos.
 */
export interface SimAccount {
  appSecret: string;
  receivables: Record<string, unknown>[];
  payables: Record<string, unknown>[];
  /** Pedidos de venda (etapa 8I). Estrutura segundo o artigo "Incluindo um pedido de venda via API"; a listagem não foi conferida. */
  salesOrders?: Record<string, unknown>[];
  /** Posições de estoque (etapa 8I). Nomes de campo não conferidos contra o Omie real. */
  stock?: Record<string, unknown>[];
}

export class OmieSimulator implements JsonHttpTransport {
  readonly calls: Array<{ url: string; call: string; appKey: string; param: Record<string, unknown> }> = [];
  readonly accounts = new Map<string, SimAccount>();
  perMinuteLimit = 240;
  now = () => Date.now();
  /** Comportamentos injetados, consumidos em ordem. */
  queue: Array<"transport_error" | "http_503" | "block_425"> = [];
  private active = 0;
  maxActive = 0;
  latencyMs = 0;
  private stamps = new Map<string, number[]>();

  async get(): Promise<JsonHttpResponse> {
    throw new Error("n/a");
  }

  async postForm(): Promise<JsonHttpResponse> {
    throw new OmieSimulatorFormUnsupported();
  }

  async post(url: string, body: unknown): Promise<JsonHttpResponse> {
    const b = body as { call: string; app_key: string; app_secret: string; param: Record<string, unknown>[] };
    this.calls.push({ url, call: b.call, appKey: b.app_key, param: b.param?.[0] ?? {} });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
      const injected = this.queue.shift();
      if (injected === "transport_error") throw new TransportError();
      if (injected === "http_503") return { status: 503, body: undefined };
      if (injected === "block_425") return { status: 425, body: { faultstring: "Consumo redundante detectado: método bloqueado" } };

      const account = this.accounts.get(b.app_key);
      if (!account || account.appSecret !== b.app_secret) {
        return { status: 500, body: { faultcode: "SOAP-ENV:Client-1", faultstring: "App Key ou App Secret inválidos" } };
      }
      const key = `${b.app_key}:${b.call}`;
      const t = this.now();
      const recent = (this.stamps.get(key) ?? []).filter((s) => t - s < 60_000);
      recent.push(t);
      this.stamps.set(key, recent);
      if (recent.length > this.perMinuteLimit) return { status: 425, body: { faultstring: "Bloqueado por excesso de requisições" } };

      const isReceivable = b.call === "ListarContasReceber" && url.endsWith("financeiro/contareceber/");
      const isPayable = b.call === "ListarContasPagar" && url.endsWith("financeiro/contapagar/");
      const isOrders = b.call === "ListarPedidos" && url.endsWith("produtos/pedido/");
      const isStock = b.call === "ListarPosEstoque" && url.endsWith("estoque/consulta/");
      if (!isReceivable && !isPayable && !isOrders && !isStock) {
        return { status: 500, body: { faultstring: "Método não encontrado" } };
      }
      const param = b.param?.[0] ?? {};
      const page = Number(isStock ? param.nPagina ?? 1 : param.pagina ?? 1);
      const size = Math.min(Number(isStock ? param.nRegPorPagina ?? 100 : param.registros_por_pagina ?? 100), 100);
      let rows = isReceivable ? account.receivables : isPayable ? account.payables : isOrders ? account.salesOrders ?? [] : account.stock ?? [];
      if (param.filtrar_apenas_alteracao === "S" && typeof param.filtrar_por_data_de === "string") {
        const [d, m, y] = param.filtrar_por_data_de.split("/").map(Number);
        const from = Date.UTC(y, m - 1, d);
        rows = rows.filter((row) => {
          const alt = ((row.info ?? row.infoCadastro) as { dAlt?: string } | undefined)?.dAlt;
          if (!alt) return true;
          const [dd, mm, yy] = alt.split("/").map(Number);
          return Date.UTC(yy, mm - 1, dd) >= from;
        });
      }
      const totalPages = Math.max(1, Math.ceil(rows.length / size));
      if (rows.length === 0 || page > totalPages) {
        return { status: 500, body: { faultstring: `Não existem registros para a página [${page}]!` } };
      }
      const slice = rows.slice((page - 1) * size, page * size);
      if (isStock) {
        return { status: 200, body: { nPagina: page, nTotPaginas: totalPages, nRegistros: slice.length, nTotRegistros: rows.length, dDataPosicao: param.dDataPosicao, produtos: slice } };
      }
      return {
        status: 200,
        body: {
          pagina: page,
          total_de_paginas: totalPages,
          registros: slice.length,
          total_de_registros: rows.length,
          [isReceivable ? "conta_receber_cadastro" : isPayable ? "conta_pagar_cadastro" : "pedido_venda_produto"]: slice,
        },
      };
    } finally {
      this.active -= 1;
    }
  }
}

export class OmieSimulatorFormUnsupported {}

export class InMemoryCredentialStore implements CredentialStore {
  private readonly entries = new Map<string, ConnectorCredential>();
  set(tenantId: string, secretRef: string, credential: ConnectorCredential) {
    this.entries.set(`${tenantId}\u0000${secretRef}`, credential);
  }
  async resolve(tenantId: string, secretRef: string): Promise<ConnectorCredential> {
    const found = this.entries.get(`${tenantId}\u0000${secretRef}`);
    if (!found) throw new CredentialNotFoundError();
    return found;
  }
}

export function receivable(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    codigo_lancamento_omie: id,
    codigo_cliente_fornecedor: 900 + id,
    status_titulo: "A VENCER",
    data_vencimento: "20/11/2026",
    data_emissao: "01/10/2026",
    valor_documento: 100.5,
    info: { dAlt: "05/10/2026", hAlt: "10:30:00" },
    ...over,
  };
}

export function salesOrder(id: number, over: { cabecalho?: Record<string, unknown>; infoCadastro?: Record<string, unknown>; total?: number; itens?: Record<string, unknown>[] } = {}): Record<string, unknown> {
  return {
    cabecalho: { codigo_pedido: id, codigo_cliente: 700 + id, numero_pedido: String(1000 + id), etapa: "60", quantidade_itens: (over.itens ?? [orderItem(1)]).length, ...over.cabecalho },
    det: over.itens ?? [orderItem(1)],
    total_pedido: { valor_total_pedido: over.total ?? 250 },
    infoCadastro: { cFaturado: "S", cCancelado: "N", dInc: "02/10/2026", hInc: "09:00:00", dFat: "05/10/2026", hFat: "14:30:00", dAlt: "05/10/2026", hAlt: "14:31:00", ...over.infoCadastro },
  };
}

export function orderItem(seq: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ide: { codigo_item: 5000 + seq },
    produto: { codigo_produto: 300 + seq, descricao: `Produto ${seq}`, quantidade: 2, valor_unitario: 125, valor_total: 250, ...over },
  };
}

export function stockPosition(id: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { nCodProd: id, cCodigo: `P${id}`, cDescricao: `Produto ${id}`, nSaldo: 10, estoque_minimo: 5, nCMC: 12.5, ...over };
}
