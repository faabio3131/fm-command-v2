import { check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Configuração do canal por empresa (etapa 12): qual provedor, qual remetente e qual referência de credencial no cofre. */
export const channelConfigs = pgTable("fmcc_channel_config", {
  tenantId: text("tenant_id").notNull(),
  kind: text("kind").notNull(),
  providerId: text("provider_id").notNull(),
  secretRef: text("secret_ref"),
  sender: text("sender").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  minSeverity: text("min_severity").notNull().default("warning"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.kind] }),
  check("fmcc_channel_config_kind_ck", sql`${t.kind} in ('email','whatsapp')`),
  check("fmcc_channel_config_severity_ck", sql`${t.minSeverity} in ('info','warning','critical')`),
]);

export const channelRecipients = pgTable("fmcc_channel_recipient", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  kind: text("kind").notNull(),
  address: text("address").notNull(),
  label: text("label").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fmcc_channel_recipient_uq").on(t.tenantId, t.kind, t.address),
  index("fmcc_channel_recipient_tenant_idx").on(t.tenantId, t.kind),
  check("fmcc_channel_recipient_kind_ck", sql`${t.kind} in ('email','whatsapp')`),
]);

/** Recibo de cada envio. A chave (empresa, canal, destinatário, identidade do envio) impede enviar a mesma coisa duas vezes. */
export const channelDeliveries = pgTable("fmcc_channel_delivery", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  kind: text("kind").notNull(),
  providerId: text("provider_id").notNull(),
  recipient: text("recipient").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  attemptStartedAt: timestamp("attempt_started_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  errorCode: text("error_code"),
  subject: text("subject"),
  /** Só o resumo do conteúdo: o recibo prova o que foi enviado sem guardar a mensagem. */
  contentHash: text("content_hash").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("fmcc_channel_delivery_dedupe_uq").on(t.tenantId, t.kind, t.recipient, t.dedupeKey),
  index("fmcc_channel_delivery_due_idx").on(t.status, t.nextAttemptAt),
  index("fmcc_channel_delivery_tenant_time_idx").on(t.tenantId, t.createdAt),
  check("fmcc_channel_delivery_status_ck", sql`${t.status} in ('pending','sending','sent','failed_transient','failed','uncertain')`),
]);
