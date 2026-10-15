import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgUnits } from "./unit-schema";

/** Provedores de IA conhecidos. A chave nunca fica aqui: so a referencia "env://NOME" (ADR-017). */
export const aiProviders = pgTable("fmcc_ai_provider", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull().default("openai_compatible"),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  secretRef: text("secret_ref").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  timeoutMs: integer("timeout_ms").notNull().default(30000),
  currency: text("currency").notNull(),
  inputMinorPerMillion: integer("input_minor_per_million").notNull().default(0),
  outputMinorPerMillion: integer("output_minor_per_million").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("fmcc_ai_provider_kind_ck", sql`${t.kind} in ('openai_compatible')`),
  check("fmcc_ai_provider_secret_ck", sql`${t.secretRef} ~ '^env://AI_KEY_[A-Z0-9_]{1,56}$'`),
  check("fmcc_ai_provider_timeout_ck", sql`${t.timeoutMs} between 1000 and 120000`),
  check("fmcc_ai_provider_currency_ck", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  check("fmcc_ai_provider_price_ck", sql`${t.inputMinorPerMillion} between 0 and 100000000 and ${t.outputMinorPerMillion} between 0 and 100000000`),
]);

/** Tabela de roteamento. tenant_id vazio = linha padrao; com tenant_id = linha do cliente, que substitui a padrao. */
export const aiRoutes = pgTable("fmcc_ai_route", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskType: text("task_type").notNull(),
  tenantId: text("tenant_id"),
  providerId: text("provider_id").notNull().references(() => aiProviders.id),
  role: text("role").notNull(),
  weight: integer("weight").notNull().default(1),
  maxConcurrent: integer("max_concurrent").notNull().default(8),
}, (t) => [
  uniqueIndex("fmcc_ai_route_uq").on(sql`coalesce(${t.tenantId}, '')`, t.taskType, t.providerId),
  index("fmcc_ai_route_task_idx").on(t.taskType),
  check("fmcc_ai_route_type_ck", sql`${t.taskType} in ('analysis','synthesis','attendance','transcription','decision')`),
  check("fmcc_ai_route_role_ck", sql`${t.role} in ('primary','reserve')`),
  check("fmcc_ai_route_weight_ck", sql`${t.weight} >= 1 and ${t.maxConcurrent} >= 1`),
]);

/** Provedores permitidos para uma empresa. Sem linha = todos os provedores habilitados. */
export const aiTenantPolicies = pgTable("fmcc_ai_tenant_policy", {
  tenantId: text("tenant_id").primaryKey(),
  allowedProviders: text("allowed_providers").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Uso e custo de cada chamada, por empresa e unidade. Custo em milionesimos da unidade menor (exato, sem arredondar). */
export const aiUsage = pgTable("fmcc_ai_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  unitId: uuid("unit_id"),
  taskId: text("task_id").notNull(),
  attempt: integer("attempt").notNull().default(1),
  taskType: text("task_type").notNull(),
  providerId: text("provider_id").notNull(),
  model: text("model").notNull(),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull(),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull(),
  estimated: boolean("estimated").notNull().default(false),
  costMicroMinor: bigint("cost_micro_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Mesma tentativa + mesmo provedor = mesma chamada: regravar nao duplica. Nova tentativa e nova chamada paga: nova linha.
  uniqueIndex("fmcc_ai_usage_call_uq").on(t.taskId, t.attempt, t.providerId),
  index("fmcc_ai_usage_tenant_time_idx").on(t.tenantId, t.occurredAt),
  foreignKey({ columns: [t.tenantId, t.unitId], foreignColumns: [orgUnits.tenantId, orgUnits.id], name: "fmcc_ai_usage_unit_fk" }),
  check("fmcc_ai_usage_nonneg_ck", sql`${t.tokensIn} >= 0 and ${t.tokensOut} >= 0 and ${t.costMicroMinor} >= 0`),
]);
