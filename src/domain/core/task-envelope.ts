import { fail, isLocaleTag, isRecord, isUtcIso, ok, type Validation } from "./result";

export const TASK_TYPES = ["analysis", "synthesis", "attendance", "transcription", "decision"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** Formato único de tarefa que entra na fila do core (ADR-016, ADR-018). */
export interface TaskEnvelope {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId?: string;
  readonly taskType: TaskType;
  readonly priority: number;
  readonly locale: string;
  readonly createdAt: string;
  readonly deadlineAt: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function parseTaskEnvelope(v: unknown): Validation<TaskEnvelope> {
  if (!isRecord(v)) return fail("task.must_be_object");
  const errors: string[] = [];
  if (!nonEmpty(v.id)) errors.push("task.id_required");
  if (!nonEmpty(v.tenantId)) errors.push("task.tenant_required");
  if (v.unitId !== undefined && !nonEmpty(v.unitId)) errors.push("task.unit_invalid");
  if (!TASK_TYPES.includes(v.taskType as TaskType)) errors.push("task.type_unknown");
  if (!Number.isInteger(v.priority) || (v.priority as number) < 0 || (v.priority as number) > 100)
    errors.push("task.priority_0_to_100");
  if (!isLocaleTag(v.locale)) errors.push("task.locale_must_be_bcp47");
  if (!isUtcIso(v.createdAt)) errors.push("task.created_at_must_be_utc_iso");
  if (!isUtcIso(v.deadlineAt)) errors.push("task.deadline_must_be_utc_iso");
  if (isUtcIso(v.createdAt) && isUtcIso(v.deadlineAt) && Date.parse(v.deadlineAt) <= Date.parse(v.createdAt))
    errors.push("task.deadline_must_be_after_creation");
  if (!Number.isInteger(v.attempt) || (v.attempt as number) < 0) errors.push("task.attempt_invalid");
  if (!Number.isInteger(v.maxAttempts) || (v.maxAttempts as number) < 1) errors.push("task.max_attempts_invalid");
  if (Number.isInteger(v.attempt) && Number.isInteger(v.maxAttempts) && (v.attempt as number) > (v.maxAttempts as number))
    errors.push("task.attempt_exceeds_max");
  if (!nonEmpty(v.idempotencyKey)) errors.push("task.idempotency_key_required");
  if (!isRecord(v.payload)) errors.push("task.payload_must_be_object");
  if (errors.length > 0) return fail(...errors);
  return ok(v as unknown as TaskEnvelope);
}
