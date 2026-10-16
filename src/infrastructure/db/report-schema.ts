import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Relatório agendado por empresa (etapa 12B). O envio sai pelos canais; o recibo de cada envio fica em fmcc_channel_delivery. */
export const reports = pgTable("fmcc_report", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  metricIds: jsonb("metric_ids").$type<string[]>().notNull(),
  frequency: text("frequency").notNull(),
  hour: integer("hour").notNull(),
  weekday: integer("weekday").notNull().default(1),
  dayOfMonth: integer("day_of_month").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  /** Chave (data local) da última ocorrência já enviada. */
  lastPeriodKey: text("last_period_key"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fmcc_report_tenant_idx").on(t.tenantId),
  check("fmcc_report_frequency_ck", sql`${t.frequency} in ('daily','weekly','monthly')`),
  check("fmcc_report_hour_ck", sql`${t.hour} between 0 and 23`),
  check("fmcc_report_weekday_ck", sql`${t.weekday} between 0 and 6`),
  check("fmcc_report_dom_ck", sql`${t.dayOfMonth} between 1 and 28`),
]);
