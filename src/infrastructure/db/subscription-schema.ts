import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Assinatura do proprio FM Command (ADR-021). Separada da cobranca do Iron Fit da V1 (fmcc_billing_*), que continua intacta.
 * Dinheiro: inteiro na menor unidade + moeda ISO, sem conversao entre moedas.
 */
export const saasPlans = pgTable("fmcc_saas_plan", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("fmcc_saas_plan_id_ck", sql`${t.id} ~ '^[a-z0-9][a-z0-9_-]{1,62}$'`)]);

export const saasPlanPrices = pgTable("fmcc_saas_plan_price", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: text("plan_id").notNull().references(() => saasPlans.id),
  currency: text("currency").notNull(),
  country: text("country"),
  amountMinor: integer("amount_minor").notNull(),
  interval: text("interval").notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [
  uniqueIndex("fmcc_saas_plan_price_uq").on(t.planId, t.currency, sql`coalesce(${t.country}, '*')`, t.interval).where(sql`${t.active}`),
  check("fmcc_saas_plan_price_amount_ck", sql`${t.amountMinor} > 0`),
  check("fmcc_saas_plan_price_currency_ck", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  check("fmcc_saas_plan_price_country_ck", sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`),
  check("fmcc_saas_plan_price_interval_ck", sql`${t.interval} in ('month','year')`),
]);

/** Qual meio de cobranca atende cada pais/moeda. Trocar de provedor = mudar esta tabela (pais nulo = qualquer pais naquela moeda). */
export const saasPaymentRoutes = pgTable("fmcc_saas_payment_route", {
  id: uuid("id").defaultRandom().primaryKey(),
  currency: text("currency").notNull(),
  country: text("country"),
  providerId: text("provider_id").notNull(),
  /** Menor numero = tentado primeiro. Varios provedores por moeda/pais: o seguinte assume quando o anterior esta desligado ou indisponivel. */
  priority: integer("priority").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => [
  uniqueIndex("fmcc_saas_payment_route_uq").on(t.currency, sql`coalesce(${t.country}, '*')`, t.priority),
  uniqueIndex("fmcc_saas_payment_route_provider_uq").on(t.currency, sql`coalesce(${t.country}, '*')`, t.providerId),
  check("fmcc_saas_payment_route_priority_ck", sql`${t.priority} >= 0`),
  check("fmcc_saas_payment_route_currency_ck", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  check("fmcc_saas_payment_route_country_ck", sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`),
]);

export const saasSubscriptions = pgTable("fmcc_saas_subscription", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  planId: text("plan_id").notNull().references(() => saasPlans.id),
  // Preco GRAVADO na contratacao: mudar a tabela de precos nunca altera uma assinatura existente.
  priceAmountMinor: integer("price_amount_minor").notNull(),
  currency: text("currency").notNull(),
  interval: text("interval").notNull(),
  state: text("state").notNull(),
  providerId: text("provider_id").notNull(),
  providerCustomerRef: text("provider_customer_ref"),
  providerSubscriptionRef: text("provider_subscription_ref"),
  checkoutUrl: text("checkout_url"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  idempotencyKey: text("idempotency_key").notNull(),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fmcc_saas_subscription_idem_uq").on(t.tenantId, t.idempotencyKey),
  // Uma assinatura viva por empresa.
  uniqueIndex("fmcc_saas_subscription_live_uq").on(t.tenantId).where(sql`${t.state} in ('creating','pending','active','past_due')`),
  uniqueIndex("fmcc_saas_subscription_provider_ref_uq").on(t.providerId, t.providerSubscriptionRef).where(sql`${t.providerSubscriptionRef} is not null`),
  index("fmcc_saas_subscription_tenant_idx").on(t.tenantId, t.createdAt),
  check("fmcc_saas_subscription_state_ck", sql`${t.state} in ('creating','pending','active','past_due','cancelled','failed')`),
  check("fmcc_saas_subscription_amount_ck", sql`${t.priceAmountMinor} > 0`),
  check("fmcc_saas_subscription_interval_ck", sql`${t.interval} in ('month','year')`),
]);

/** Livro de eventos do provedor: cada evento so e aplicado uma vez. Guarda o minimo, sem dados pessoais nem o corpo bruto. */
export const saasEvents = pgTable("fmcc_saas_event", {
  providerId: text("provider_id").notNull(),
  eventId: text("event_id").notNull(),
  subscriptionId: uuid("subscription_id"),
  // Referencia e valor do evento: permitem reaplicar eventos que chegaram antes de a assinatura estar gravada (corrida real).
  subscriptionRef: text("subscription_ref").notNull(),
  amountMinor: integer("amount_minor"),
  currency: text("currency"),
  type: text("type").notNull(),
  outcome: text("outcome").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fmcc_saas_event_uq").on(t.providerId, t.eventId),
  index("fmcc_saas_event_subscription_idx").on(t.subscriptionId),
  index("fmcc_saas_event_unmatched_idx").on(t.providerId, t.subscriptionRef).where(sql`${t.outcome} = 'unmatched'`),
]);

/**
 * Tabela de taxas de cada meio de cobranca (banco/PSP), por forma de pagamento. Nenhuma taxa fica no codigo: cada banco cobra
 * o seu valor fixo e o seu percentual para boleto, PIX, cartao etc. e isso muda no tempo (vigencia). Percentual em centesimos de
 * ponto percentual (basis points: 199 = 1,99%). Dinheiro em inteiro na menor unidade da moeda.
 */
export const saasFeeSchedules = pgTable("fmcc_saas_fee_schedule", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: text("provider_id").notNull(),
  method: text("method").notNull(),
  currency: text("currency").notNull(),
  fixedMinor: integer("fixed_minor").notNull().default(0),
  percentBps: integer("percent_bps").notNull().default(0),
  minMinor: integer("min_minor").notNull().default(0),
  maxMinor: integer("max_minor"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  active: boolean("active").notNull().default(true),
}, (t) => [
  uniqueIndex("fmcc_saas_fee_schedule_uq").on(t.providerId, t.method, t.currency, t.effectiveFrom),
  check("fmcc_saas_fee_schedule_method_ck", sql`${t.method} in ('boleto','pix','card','transfer','other')`),
  check("fmcc_saas_fee_schedule_currency_ck", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  check("fmcc_saas_fee_schedule_amounts_ck", sql`${t.fixedMinor} >= 0 and ${t.minMinor} >= 0 and (${t.maxMinor} is null or ${t.maxMinor} >= ${t.minMinor})`),
  check("fmcc_saas_fee_schedule_percent_ck", sql`${t.percentBps} between 0 and 10000`),
]);
