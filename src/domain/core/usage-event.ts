import { parseMoney, type Money } from "./money";
import { fail, isRecord, isUtcIso, ok, type Validation } from "./result";

/** Evento de uso e custo de cada chamada de IA, por empresa e por unidade. */
export interface UsageEvent {
  readonly tenantId: string;
  readonly unitId?: string;
  readonly taskId: string;
  readonly providerId: string;
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cost: Money;
  readonly occurredAt: string;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export function parseUsageEvent(v: unknown): Validation<UsageEvent> {
  if (!isRecord(v)) return fail("usage.must_be_object");
  const errors: string[] = [];
  for (const k of ["tenantId", "taskId", "providerId", "model"] as const)
    if (!nonEmpty(v[k])) errors.push(`usage.${k}_required`);
  if (v.unitId !== undefined && !nonEmpty(v.unitId)) errors.push("usage.unit_invalid");
  if (!count(v.tokensIn)) errors.push("usage.tokens_in_invalid");
  if (!count(v.tokensOut)) errors.push("usage.tokens_out_invalid");
  if (!isUtcIso(v.occurredAt)) errors.push("usage.occurred_at_must_be_utc_iso");
  const cost = parseMoney(v.cost);
  if (!cost.ok) errors.push(...cost.errors.map((e) => `usage.cost.${e}`));
  if (errors.length > 0) return fail(...errors);
  return ok(v as unknown as UsageEvent);
}
