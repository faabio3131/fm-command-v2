import type { ConnectorFact } from "@/domain/integration/contracts";
import type { DateFormat, FieldSource, StreamDefinition } from "@/domain/integration/connector-definition";
import { toMinorUnits } from "@/infrastructure/connectors/money";
import { getPath } from "./json-path";

export interface DeclarativeMappingOptions {
  readonly currency: string;
  readonly retrievedAt: Date;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function parseDay(value: unknown, format: DateFormat | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  let y: number, m: number, d: number;
  if (format === "dd/mm/yyyy") {
    const r = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
    if (!r) return undefined;
    [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  } else {
    const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (!r) return undefined;
    [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return undefined;
  return check.toISOString().slice(0, 10);
}

function parseInstant(value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value.trim())) return undefined;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function read(record: unknown, source: FieldSource | undefined): unknown {
  return source ? getPath(record, source.path) : undefined;
}

export function mapDeclarativeRecord(
  stream: StreamDefinition,
  record: unknown,
  options: DeclarativeMappingOptions,
): ConnectorFact | undefined {
  const f = stream.fields;
  const externalId = text(read(record, f.externalId));
  if (!externalId) return undefined;

  const unavailable: string[] = [];
  const payload: Record<string, unknown> = { currency: options.currency };

  if (f.amount) {
    const raw = read(record, f.amount);
    const minor = f.amount.type === "minor"
      ? (typeof raw === "number" && Number.isSafeInteger(raw) ? raw : undefined)
      : toMinorUnits(raw, options.currency);
    if (minor === undefined) unavailable.push("amountMinor");
    else payload.amountMinor = minor;
  }
  if (f.dueDate) {
    const v = parseDay(read(record, f.dueDate), f.dueDate.dateFormat);
    if (!v) unavailable.push("dueDate");
    else payload.dueDate = v;
  }
  if (f.issueDate) {
    const v = parseDay(read(record, f.issueDate), f.issueDate.dateFormat);
    if (!v) unavailable.push("issueDate");
    else payload.issueDate = v;
  }
  if (f.status) {
    const rawStatus = text(read(record, f.status));
    const mapped = rawStatus ? f.status.map[rawStatus.toUpperCase()] : undefined;
    if (!mapped) unavailable.push("status");
    else payload.status = mapped;
    if (rawStatus) payload.sourceStatus = rawStatus;
  }
  if (f.counterpartyRef) {
    const v = text(read(record, f.counterpartyRef));
    if (!v) unavailable.push("counterpartyRef");
    else payload.counterpartyRef = v;
  }

  // Sem data de alteração não há como saber qual versão é a mais nova: vale a leitura mais recente.
  const changed = f.changedAt ? parseInstant(read(record, f.changedAt)) : undefined;
  const sourceTimestamp = changed ?? options.retrievedAt;
  payload.timestampBasis = changed ? "changed_at" : "retrieved_at";
  if (unavailable.length) payload.unavailable = unavailable;

  const unitRef = text(read(record, f.unitRef));
  return { externalId: `${stream.name}:${externalId}`, factType: stream.factType, payload, sourceTimestamp, unitRef };
}
