/**
 * Definição declarativa de um conector REST: um ERP novo é um arquivo de dados
 * validado, não código. A definição é do operador da plataforma (versionada no
 * repositório); a empresa só escolhe uma e preenche os parâmetros permitidos.
 */
export type FieldType = "string" | "decimal" | "minor" | "date" | "datetime";
export type DateFormat = "iso" | "dd/mm/yyyy";
export type CanonicalStatus = "open" | "overdue" | "settled" | "cancelled";

export interface FieldSource {
  readonly path: string;
  readonly type?: FieldType;
  readonly dateFormat?: DateFormat;
}

export type PaginationDefinition =
  | {
      readonly style: "page";
      readonly pageParam: string;
      readonly sizeParam?: string;
      readonly size: number;
      readonly startPage?: number;
      readonly totalPagesPath?: string;
      /** Caminho do total de REGISTROS (não de páginas) na resposta. */
      readonly totalCountPath?: string;
    }
  | {
      readonly style: "offset";
      readonly offsetParam: string;
      readonly sizeParam: string;
      readonly size: number;
      readonly totalPagesPath?: string;
    };

export interface StreamDefinition {
  readonly name: string;
  readonly factType: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly pagination: PaginationDefinition;
  readonly recordsPath: string;
  /** Intervalo de datas obrigatório na consulta (ex.: vencimento de/até), relativo a hoje. */
  readonly window?: {
    readonly fromParam: string;
    readonly toParam: string;
    readonly pastDays: number;
    readonly futureDays: number;
  };
  readonly incremental?: { readonly param: string; readonly format: "iso_date" | "iso_datetime" };
  readonly fields: {
    readonly externalId: FieldSource;
    readonly unitRef?: FieldSource;
    readonly changedAt?: FieldSource;
    readonly amount?: FieldSource;
    readonly dueDate?: FieldSource;
    readonly issueDate?: FieldSource;
    readonly counterpartyRef?: FieldSource;
    readonly status?: FieldSource & { readonly map: Readonly<Record<string, CanonicalStatus>> };
  };
}

export type AuthDefinition =
  | { readonly type: "oauth2"; readonly providerId: string }
  | { readonly type: "api_key"; readonly header: string };

export interface ConnectorDefinition {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly regions: readonly string[];
  /** `planned` aparece no catálogo mas ainda não conecta (falta confirmar a API do sistema). */
  readonly status: "ready" | "planned";
  readonly auth: AuthDefinition;
  readonly baseUrl: string;
  readonly limits: { readonly requestsPerMinute: number; readonly maxConcurrent: number };
  readonly health?: { readonly path: string };
  /** Nomes de parâmetros por empresa usados em `{nome}` nos caminhos (ex.: identificador da conta). */
  readonly variables?: readonly string[];
  readonly streams: readonly StreamDefinition[];
}

export class ConnectorDefinitionError extends Error {
  constructor(readonly where: string, message: string) {
    super(`integration.connector_definition_invalid:${where}:${message}`);
    this.name = "ConnectorDefinitionError";
  }
}

const ID = /^[a-z][a-z0-9_]{1,40}$/;
const PARAM = /^[A-Za-z0-9_.\[\]-]{1,64}$/;
const HEADER = /^[A-Za-z0-9-]{1,64}$/;
const VAR_NAME = /^[a-z][a-zA-Z0-9]{0,31}$/;
const PATH_SEGMENT = /^[A-Za-z0-9_.\-/{}~]*$/;

export const VARIABLE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function fail(where: string, message: string): never {
  throw new ConnectorDefinitionError(where, message);
}
function str(v: unknown, where: string, pattern?: RegExp): string {
  if (typeof v !== "string" || !v.trim()) fail(where, "texto obrigatório");
  if (pattern && !pattern.test(v)) fail(where, "formato inválido");
  return v;
}
function int(v: unknown, where: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) fail(where, `inteiro entre ${min} e ${max}`);
  return v;
}

function checkPath(value: unknown, where: string, variables: ReadonlySet<string>): string {
  const p = str(value, where);
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("..") || !PATH_SEGMENT.test(p)) fail(where, "caminho inválido");
  for (const m of p.matchAll(/\{([^}]*)\}/g)) {
    if (!variables.has(m[1])) fail(where, `variável não declarada: ${m[1]}`);
  }
  if ((p.match(/[{}]/g) ?? []).length !== (p.match(/\{[^}]*\}/g) ?? []).length * 2) fail(where, "chaves desbalanceadas");
  return p;
}

function field(v: unknown, where: string, required = false): FieldSource | undefined {
  if (v === undefined) {
    if (required) fail(where, "campo obrigatório");
    return undefined;
  }
  if (!isObject(v)) return fail(where, "objeto esperado");
  const path = str(v.path, `${where}.path`, /^[A-Za-z0-9_$.-]{1,128}$/);
  const type = v.type === undefined ? undefined : (["string", "decimal", "minor", "date", "datetime"] as const).find((t) => t === v.type);
  if (v.type !== undefined && !type) fail(`${where}.type`, "tipo desconhecido");
  const dateFormat = v.dateFormat === undefined ? undefined : (["iso", "dd/mm/yyyy"] as const).find((t) => t === v.dateFormat);
  if (v.dateFormat !== undefined && !dateFormat) fail(`${where}.dateFormat`, "formato desconhecido");
  return { path, type, dateFormat };
}

export function validateConnectorDefinition(raw: unknown): ConnectorDefinition {
  if (!isObject(raw)) return fail("$", "objeto esperado");
  const id = str(raw.id, "id", ID);
  const status = raw.status === "ready" || raw.status === "planned" ? raw.status : fail("status", "ready ou planned");
  const variables = new Set<string>();
  if (raw.variables !== undefined) {
    if (!Array.isArray(raw.variables) || raw.variables.length > 8) fail("variables", "lista de até 8");
    for (const v of raw.variables) variables.add(str(v, "variables[]", VAR_NAME));
  }

  const auth = raw.auth;
  if (!isObject(auth)) return fail("auth", "objeto esperado");
  let authDef: AuthDefinition;
  if (auth.type === "oauth2") authDef = { type: "oauth2", providerId: str(auth.providerId, "auth.providerId", ID) };
  else if (auth.type === "api_key") authDef = { type: "api_key", header: str(auth.header, "auth.header", HEADER) };
  else return fail("auth.type", "oauth2 ou api_key");

  let baseUrl = "";
  if (status === "ready" || raw.baseUrl !== undefined) {
    baseUrl = str(raw.baseUrl, "baseUrl");
    let url: URL;
    try { url = new URL(baseUrl); } catch { return fail("baseUrl", "URL inválida"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) fail("baseUrl", "https sem credencial, consulta ou fragmento");
    baseUrl = url.toString().replace(/\/$/, "");
  }

  const limits = raw.limits;
  if (!isObject(limits)) return fail("limits", "objeto esperado");
  const limitsDef = {
    requestsPerMinute: int(limits.requestsPerMinute, "limits.requestsPerMinute", 1, 100_000),
    maxConcurrent: int(limits.maxConcurrent, "limits.maxConcurrent", 1, 50),
  };

  const healthPath = isObject(raw.health) ? checkPath(raw.health.path, "health.path", variables) : undefined;

  if (!Array.isArray(raw.streams) || raw.streams.length > 16) return fail("streams", "lista de até 16");
  if (status === "ready" && raw.streams.length === 0) fail("streams", "conector pronto precisa de ao menos um fluxo");
  const names = new Set<string>();
  const streams: StreamDefinition[] = raw.streams.map((s, i) => {
    const w = `streams[${i}]`;
    if (!isObject(s)) return fail(w, "objeto esperado");
    const name = str(s.name, `${w}.name`, ID);
    if (names.has(name)) fail(`${w}.name`, "repetido");
    names.add(name);
    const pag = s.pagination;
    if (!isObject(pag)) return fail(`${w}.pagination`, "objeto esperado");
    let pagination: PaginationDefinition;
    const totalPagesPath = pag.totalPagesPath === undefined ? undefined : str(pag.totalPagesPath, `${w}.pagination.totalPagesPath`, /^[A-Za-z0-9_$.-]{1,128}$/);
    const totalCountPath = pag.totalCountPath === undefined ? undefined : str(pag.totalCountPath, `${w}.pagination.totalCountPath`, /^[A-Za-z0-9_$.-]{1,128}$/);
    if (pag.style === "page") {
      pagination = {
        style: "page",
        pageParam: str(pag.pageParam, `${w}.pagination.pageParam`, PARAM),
        sizeParam: pag.sizeParam === undefined ? undefined : str(pag.sizeParam, `${w}.pagination.sizeParam`, PARAM),
        size: int(pag.size, `${w}.pagination.size`, 1, 1000),
        startPage: pag.startPage === undefined ? undefined : int(pag.startPage, `${w}.pagination.startPage`, 0, 1),
        totalPagesPath,
        totalCountPath,
      };
    } else if (pag.style === "offset") {
      pagination = {
        style: "offset",
        offsetParam: str(pag.offsetParam, `${w}.pagination.offsetParam`, PARAM),
        sizeParam: str(pag.sizeParam, `${w}.pagination.sizeParam`, PARAM),
        size: int(pag.size, `${w}.pagination.size`, 1, 1000),
        totalPagesPath,
      };
    } else return fail(`${w}.pagination.style`, "page ou offset");

    let query: Record<string, string> | undefined;
    if (s.query !== undefined) {
      if (!isObject(s.query) || Object.keys(s.query).length > 16) return fail(`${w}.query`, "objeto de até 16 itens");
      query = {};
      for (const [k, v] of Object.entries(s.query)) {
        str(k, `${w}.query`, PARAM);
        const val = str(v, `${w}.query.${k}`);
        for (const m of val.matchAll(/\{([^}]*)\}/g)) if (!variables.has(m[1])) fail(`${w}.query.${k}`, `variável não declarada: ${m[1]}`);
        query[k] = val;
      }
    }

    let window: StreamDefinition["window"];
    if (s.window !== undefined) {
      const win = s.window;
      if (!isObject(win)) return fail(`${w}.window`, "objeto esperado");
      window = {
        fromParam: str(win.fromParam, `${w}.window.fromParam`, PARAM),
        toParam: str(win.toParam, `${w}.window.toParam`, PARAM),
        pastDays: int(win.pastDays, `${w}.window.pastDays`, 0, 3650),
        futureDays: int(win.futureDays, `${w}.window.futureDays`, 0, 3650),
      };
    }

    const inc = s.incremental;
    let incremental: StreamDefinition["incremental"];
    if (inc !== undefined) {
      if (!isObject(inc) || (inc.format !== "iso_date" && inc.format !== "iso_datetime")) return fail(`${w}.incremental`, "param e format (iso_date|iso_datetime)");
      incremental = { param: str(inc.param, `${w}.incremental.param`, PARAM), format: inc.format };
    }

    const f = s.fields;
    if (!isObject(f)) return fail(`${w}.fields`, "objeto esperado");
    let statusField: StreamDefinition["fields"]["status"];
    if (f.status !== undefined) {
      const base = field(f.status, `${w}.fields.status`, true)!;
      const map = isObject(f.status) ? f.status.map : undefined;
      if (!isObject(map) || Object.keys(map).length === 0 || Object.keys(map).length > 64) return fail(`${w}.fields.status.map`, "mapa de 1 a 64 itens");
      const out: Record<string, CanonicalStatus> = {};
      for (const [k, v] of Object.entries(map)) {
        if (v !== "open" && v !== "overdue" && v !== "settled" && v !== "cancelled") return fail(`${w}.fields.status.map.${k}`, "open|overdue|settled|cancelled");
        out[k.trim().toUpperCase()] = v;
      }
      statusField = { ...base, map: out };
    }
    return {
      name,
      factType: str(s.factType, `${w}.factType`, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
      path: checkPath(s.path, `${w}.path`, variables),
      query,
      pagination,
      recordsPath: str(s.recordsPath, `${w}.recordsPath`, /^(\$|[A-Za-z0-9_$.-]{1,128})$/),
      window,
      incremental,
      fields: {
        externalId: field(f.externalId, `${w}.fields.externalId`, true)!,
        unitRef: field(f.unitRef, `${w}.fields.unitRef`),
        changedAt: field(f.changedAt, `${w}.fields.changedAt`),
        amount: field(f.amount, `${w}.fields.amount`),
        dueDate: field(f.dueDate, `${w}.fields.dueDate`),
        issueDate: field(f.issueDate, `${w}.fields.issueDate`),
        counterpartyRef: field(f.counterpartyRef, `${w}.fields.counterpartyRef`),
        status: statusField,
      },
    };
  });

  return {
    id,
    version: int(raw.version, "version", 1, 10_000),
    label: str(raw.label, "label"),
    regions: Array.isArray(raw.regions) ? raw.regions.map((r) => str(r, "regions[]", /^[A-Z]{2,6}$/)) : [],
    status,
    auth: authDef,
    baseUrl,
    limits: limitsDef,
    health: healthPath ? { path: healthPath } : undefined,
    variables: [...variables],
    streams,
  };
}
