import type { TaskType } from "./task-envelope";
import { fail, ok, type Validation } from "./result";

/**
 * Política de roteamento (ADR-017). Tabela configurável por tipo de tarefa;
 * a linha do cliente (tenantId) substitui a padrão (tenantId = null).
 * A escolha é feita pela política, nunca por uma IA.
 */
export interface RoutingRow {
  readonly taskType: TaskType;
  readonly tenantId: string | null;
  readonly providerId: string;
  readonly role: "primary" | "reserve";
  readonly weight: number;
  readonly maxConcurrent: number;
}

export interface ProviderState {
  readonly circuitOpen: boolean;
  readonly inFlight: number;
}

export interface RouteRequest {
  readonly rows: readonly RoutingRow[];
  readonly taskType: TaskType;
  readonly tenantId: string;
  /** Lista de provedores permitidos para o cliente; ausente = todos. */
  readonly allowedProviders?: readonly string[];
  readonly providerState: Readonly<Record<string, ProviderState>>;
  /** Número em [0, 1) injetado para o sorteio por peso (determinístico em teste). */
  readonly pick: number;
}

export interface RouteChoice {
  readonly providerId: string;
  readonly role: "primary" | "reserve";
  /** Reservas disponíveis, em ordem, para tentar se o escolhido falhar de forma transitória. */
  readonly reserves: readonly string[];
}

export function validateRows(rows: readonly RoutingRow[]): Validation<readonly RoutingRow[]> {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!(r.weight > 0) || !Number.isFinite(r.weight)) errors.push(`routing.weight_must_be_positive:${r.providerId}`);
    if (!Number.isInteger(r.maxConcurrent) || r.maxConcurrent < 1) errors.push(`routing.max_concurrent_invalid:${r.providerId}`);
    const key = `${r.tenantId ?? "*"}|${r.taskType}|${r.providerId}`;
    if (seen.has(key)) errors.push(`routing.duplicate_provider_row:${r.providerId}`);
    seen.add(key);
  }
  return errors.length > 0 ? fail(...errors) : ok(rows);
}

function usable(r: RoutingRow, req: RouteRequest): boolean {
  if (req.allowedProviders && !req.allowedProviders.includes(r.providerId)) return false;
  const s = req.providerState[r.providerId];
  if (!s) return true;
  return !s.circuitOpen && s.inFlight < r.maxConcurrent;
}

function weighted(rows: readonly RoutingRow[], pick: number): RoutingRow {
  const total = rows.reduce((a, r) => a + r.weight, 0);
  let acc = 0;
  const target = Math.min(Math.max(pick, 0), 0.999999999) * total;
  for (const r of rows) {
    acc += r.weight;
    if (target < acc) return r;
  }
  return rows[rows.length - 1];
}

export function resolveRoute(req: RouteRequest): Validation<RouteChoice> {
  const valid = validateRows(req.rows);
  if (!valid.ok) return valid;

  const forTask = req.rows.filter((r) => r.taskType === req.taskType);
  const own = forTask.filter((r) => r.tenantId === req.tenantId);
  // A linha mais específica vence: se o cliente tem linhas para a tarefa, só elas valem.
  const effective = own.length > 0 ? own : forTask.filter((r) => r.tenantId === null);

  const available = effective.filter((r) => usable(r, req));
  const primaries = available.filter((r) => r.role === "primary");
  const reserves = available
    .filter((r) => r.role === "reserve")
    .sort((a, b) => b.weight - a.weight)
    .map((r) => r.providerId);

  if (primaries.length > 0) {
    const chosen = weighted(primaries, req.pick);
    return ok({ providerId: chosen.providerId, role: "primary", reserves });
  }
  if (reserves.length > 0) {
    return ok({ providerId: reserves[0], role: "reserve", reserves: reserves.slice(1) });
  }
  return fail("routing.no_provider_available");
}
