import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const auditEvents = pgTable("fmcc_audit_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  actorId: text("actor_id").notNull(),
  actorType: text("actor_type").notNull(),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  result: text("result").notNull(),
  correlationId: text("correlation_id").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fmcc_audit_tenant_time_idx").on(t.tenantId, t.occurredAt),
  index("fmcc_audit_correlation_idx").on(t.correlationId),
]);
