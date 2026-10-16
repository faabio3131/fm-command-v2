import type { ConnectorFact } from "@/domain/integration/contracts";
import { toMinorUnits } from "@/infrastructure/connectors/money";

/**
 * Tradução dos registros do Omie para fatos canônicos. Regra do produto: o que
 * o Omie não entregou fica ausente e listado em `unavailable`; nunca vira zero.
 * Os nomes de campo seguem a documentação pública do Omie e ainda NÃO foram
 * conferidos contra uma conta real (ver docs/medicoes/CONECTORES-8E).
 */
export type OmieStream = "receivable" | "payable";

export const OMIE_STREAMS: Record<OmieStream, {
  path: string;
  method: string;
  listKey: string;
  factType: string;
}> = {
  receivable: {
    path: "financeiro/contareceber",
    method: "ListarContasReceber",
    listKey: "conta_receber_cadastro",
    factType: "finance.receivable",
  },
  payable: {
    path: "financeiro/contapagar",
    method: "ListarContasPagar",
    listKey: "conta_pagar_cadastro",
    factType: "finance.payable",
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
  stream: OmieStream,
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

  const unitRef = options.unitRefField ? text(r[options.unitRefField]) : undefined;
  // O Omie numera receber e pagar separadamente: o fluxo entra no identificador para não colidirem.
  return { externalId: `${stream}:${externalId}`, factType: OMIE_STREAMS[stream].factType, payload, sourceTimestamp, unitRef };
}
