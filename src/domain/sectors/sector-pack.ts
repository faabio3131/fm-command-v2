import type { MetricDefinition } from "@/domain/metrics/registry";
import { isFrequency, type ReportFrequency } from "@/domain/reports/schedule";

/**
 * Pacote por setor: um arquivo de dados validado (não código) que traz as métricas do setor, o contrato dos fatos que uma fonte de
 * dados deve entregar, as seções da tela e um relatório sugerido. A empresa liga ou desliga o pacote; nada aqui depende de cliente.
 * Os valores vêm dos conectores da 8E: qualquer sistema do setor que mapeie seus registros para estes tipos de fato alimenta o pacote.
 */
export type Locale2 = "pt-BR" | "en-US";
export type LocalizedText = Readonly<Record<Locale2, string>>;
export type CanonicalFactStatus = "open" | "overdue" | "settled" | "cancelled";

export interface PackMetric {
  readonly id: string;
  readonly kind: "count" | "sum";
  readonly factType: string;
  readonly grain: "period" | "as_of";
  readonly statuses?: readonly CanonicalFactStatus[];
  readonly name: LocalizedText;
  readonly description: LocalizedText;
}

export interface PackFactContract {
  readonly factType: string;
  /** O que os registros desse tipo representam. */
  readonly description: LocalizedText;
  /** Significado de cada status canônico neste tipo (só os usados). */
  readonly statusMeaning: Readonly<Partial<Record<CanonicalFactStatus, LocalizedText>>>;
  /** Traz valor monetário (centavos + moeda)? */
  readonly money: boolean;
}

export interface SectorPack {
  readonly id: string;
  readonly version: number;
  readonly label: LocalizedText;
  readonly description: LocalizedText;
  readonly facts: readonly PackFactContract[];
  readonly metrics: readonly PackMetric[];
  readonly sections: readonly { readonly title: LocalizedText; readonly metricIds: readonly string[] }[];
  readonly suggestedReport: { readonly name: LocalizedText; readonly metricIds: readonly string[]; readonly frequency: ReportFrequency; readonly hour: number };
}

export class SectorPackError extends Error {
  constructor(readonly where: string, message: string) {
    super(`sectors.pack_invalid:${where}:${message}`);
    this.name = "SectorPackError";
  }
}

const ID = /^[a-z][a-z0-9_]{1,30}$/;
const STATUSES: readonly CanonicalFactStatus[] = ["open", "overdue", "settled", "cancelled"];
/** Tipos de fato que pertencem à plataforma: um pacote não pode se apropriar deles. */
const RESERVED_FACT_PREFIXES = ["trial.", "subscription.", "billing.", "payment.", "revenue.", "receivable.", "finance.", "cost.", "lead.", "incident.", "job.", "integration.", "service.", "usage.", "support."];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function fail(where: string, message: string): never { throw new SectorPackError(where, message); }

function localized(v: unknown, where: string): LocalizedText {
  if (!isObject(v)) return fail(where, "texto por idioma esperado");
  const out = {} as Record<Locale2, string>;
  for (const locale of ["pt-BR", "en-US"] as const) {
    const t = v[locale];
    if (typeof t !== "string" || !t.trim() || t.length > 400) fail(`${where}.${locale}`, "texto obrigatório nos dois idiomas");
    out[locale] = t.trim();
  }
  return out;
}

export function validateSectorPack(raw: unknown): SectorPack {
  if (!isObject(raw)) return fail("$", "objeto esperado");
  const id = typeof raw.id === "string" && ID.test(raw.id) ? raw.id : fail("id", "formato inválido");
  const version = typeof raw.version === "number" && Number.isInteger(raw.version) && raw.version >= 1 ? raw.version : fail("version", "inteiro >= 1");

  if (!Array.isArray(raw.facts) || raw.facts.length === 0 || raw.facts.length > 12) fail("facts", "1 a 12 tipos de fato");
  const facts: PackFactContract[] = raw.facts.map((f: unknown, i: number) => {
    const where = `facts.${i}`;
    if (!isObject(f)) return fail(where, "objeto esperado");
    const factType = typeof f.factType === "string" ? f.factType : "";
    if (!factType.startsWith(`${id}.`) || !/^[a-z][a-z0-9_.]{3,60}$/.test(factType)) fail(`${where}.factType`, `deve começar com "${id}."`);
    if (RESERVED_FACT_PREFIXES.some((p) => factType.startsWith(p))) fail(`${where}.factType`, "tipo reservado da plataforma");
    const meaning: Partial<Record<CanonicalFactStatus, LocalizedText>> = {};
    if (!isObject(f.statusMeaning)) fail(`${where}.statusMeaning`, "objeto esperado");
    for (const [status, text] of Object.entries(f.statusMeaning)) {
      if (!STATUSES.includes(status as CanonicalFactStatus)) fail(`${where}.statusMeaning.${status}`, "status desconhecido");
      meaning[status as CanonicalFactStatus] = localized(text, `${where}.statusMeaning.${status}`);
    }
    if (typeof f.money !== "boolean") fail(`${where}.money`, "booleano esperado");
    return { factType, description: localized(f.description, `${where}.description`), statusMeaning: meaning, money: f.money };
  });
  if (new Set(facts.map((f) => f.factType)).size !== facts.length) fail("facts", "tipos repetidos");

  if (!Array.isArray(raw.metrics) || raw.metrics.length === 0 || raw.metrics.length > 20) fail("metrics", "1 a 20 métricas");
  const metrics: PackMetric[] = raw.metrics.map((m: unknown, i: number) => {
    const where = `metrics.${i}`;
    if (!isObject(m)) return fail(where, "objeto esperado");
    const mid = typeof m.id === "string" ? m.id : "";
    if (!mid.startsWith(`${id}.`) || !/^[a-z][a-z0-9_.]{3,80}$/.test(mid)) fail(`${where}.id`, `deve começar com "${id}."`);
    const kind = m.kind === "count" || m.kind === "sum" ? m.kind : fail(`${where}.kind`, "count ou sum");
    const grain = m.grain === "period" || m.grain === "as_of" ? m.grain : fail(`${where}.grain`, "period ou as_of");
    const contract = facts.find((f) => f.factType === m.factType);
    if (!contract) fail(`${where}.factType`, "tipo de fato não declarado em facts");
    if (kind === "sum" && !contract.money) fail(`${where}.kind`, "soma exige tipo de fato com valor monetário");
    let statuses: CanonicalFactStatus[] | undefined;
    if (m.statuses !== undefined) {
      if (!Array.isArray(m.statuses) || m.statuses.length === 0 || !m.statuses.every((s) => STATUSES.includes(s as CanonicalFactStatus))) fail(`${where}.statuses`, "lista de status canônicos");
      statuses = m.statuses as CanonicalFactStatus[];
      for (const s of statuses) if (!contract.statusMeaning[s]) fail(`${where}.statuses`, `status "${s}" sem significado declarado no tipo de fato`);
    }
    return { id: mid, kind, factType: contract.factType, grain, statuses, name: localized(m.name, `${where}.name`), description: localized(m.description, `${where}.description`) };
  });
  if (new Set(metrics.map((m) => m.id)).size !== metrics.length) fail("metrics", "ids repetidos");
  const metricIds = new Set(metrics.map((m) => m.id));

  if (!Array.isArray(raw.sections) || raw.sections.length === 0 || raw.sections.length > 8) fail("sections", "1 a 8 seções");
  const sections = raw.sections.map((s: unknown, i: number) => {
    const where = `sections.${i}`;
    if (!isObject(s) || !Array.isArray(s.metricIds) || s.metricIds.length === 0) return fail(where, "seção com métricas");
    for (const mid of s.metricIds) if (typeof mid !== "string" || !metricIds.has(mid)) fail(`${where}.metricIds`, `métrica desconhecida: ${String(mid)}`);
    return { title: localized(s.title, `${where}.title`), metricIds: s.metricIds as string[] };
  });

  const r = raw.suggestedReport;
  if (!isObject(r) || !Array.isArray(r.metricIds) || r.metricIds.length === 0 || r.metricIds.length > 12) return fail("suggestedReport", "relatório sugerido inválido");
  for (const mid of r.metricIds) if (typeof mid !== "string" || !metricIds.has(mid)) fail("suggestedReport.metricIds", `métrica desconhecida: ${String(mid)}`);
  if (!isFrequency(r.frequency)) fail("suggestedReport.frequency", "frequência inválida");
  if (typeof r.hour !== "number" || !Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) fail("suggestedReport.hour", "hora inválida");

  return {
    id, version, label: localized(raw.label, "label"), description: localized(raw.description, "description"), facts, metrics, sections,
    suggestedReport: { name: localized(r.name, "suggestedReport.name"), metricIds: r.metricIds as string[], frequency: r.frequency, hour: r.hour },
  };
}

/** Definição de métrica do registro a partir da métrica do pacote (soma em centavos com moeda, contagem de fatos distintos). */
export function packMetricToDefinition(pack: SectorPack, m: PackMetric): MetricDefinition {
  const money = m.kind === "sum";
  return {
    metricId: m.id, version: pack.version, calculationVersion: `pack.${pack.id}.v${pack.version}`,
    displayName: m.name["pt-BR"], description: m.description["pt-BR"], kind: m.kind, factType: m.factType,
    ...(money ? { valueField: "amountMinor", valueScale: "minor" as const, currencyField: "currency" } : {}),
    ...(m.statuses ? { statuses: m.statuses } : {}),
    unit: money ? "currency" : "count", grain: m.grain, dimensions: money ? ["currency"] : [],
    timeWindow: m.grain === "period" ? "bounded_period" : "as_of", freshnessPolicy: "source_governed", sourceAuthority: `sector_pack_${pack.id}`,
  };
}
