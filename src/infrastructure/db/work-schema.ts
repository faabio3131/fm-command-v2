import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgUnits } from "./unit-schema";

/**
 * Fila de trabalho do core (ADR-018). Estados:
 * queued -> running -> succeeded | queued (repeticao) | dead | expired.
 * "dead" = acabou o numero de tentativas; "expired" = passou do prazo. Nenhum dos dois some: ficam registrados.
 */
export const workItems = pgTable("fmcc_work_item", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  unitId: uuid("unit_id"),
  taskType: text("task_type").notNull(),
  priority: integer("priority").notNull().default(50),
  locale: text("locale").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  state: text("state").notNull().default("queued"),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  workerId: text("worker_id"),
  lastError: text("last_error"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("fmcc_work_item_idem_uq").on(t.tenantId, t.idempotencyKey),
  // Cabeca da fila por empresa: permite achar "a primeira tarefa de cada empresa" sem varrer a fila inteira.
  index("fmcc_work_item_queued_head_idx").on(t.tenantId, sql`${t.priority} desc`, t.runAfter, t.createdAt).where(sql`${t.state} = 'queued'`),
  // Posses vencidas (worker que morreu) e contagem de tarefas rodando por empresa.
  index("fmcc_work_item_running_lease_idx").on(t.leaseUntil).where(sql`${t.state} = 'running'`),
  index("fmcc_work_item_running_tenant_idx").on(t.tenantId).where(sql`${t.state} = 'running'`),
  foreignKey({ columns: [t.tenantId, t.unitId], foreignColumns: [orgUnits.tenantId, orgUnits.id], name: "fmcc_work_item_unit_fk" }),
  check("fmcc_work_item_state_ck", sql`${t.state} in ('queued','running','succeeded','dead','expired')`),
  check("fmcc_work_item_type_ck", sql`${t.taskType} in ('analysis','synthesis','attendance','transcription','decision')`),
  check("fmcc_work_item_priority_ck", sql`${t.priority} between 0 and 100`),
  check("fmcc_work_item_attempts_ck", sql`${t.maxAttempts} >= 1 and ${t.attempt} >= 0 and ${t.attempt} <= ${t.maxAttempts}`),
  check("fmcc_work_item_lease_ck", sql`(${t.state} = 'running') = (${t.leaseToken} is not null and ${t.leaseUntil} is not null)`),
]);
