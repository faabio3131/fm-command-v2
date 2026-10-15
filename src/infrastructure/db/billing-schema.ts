import { bigint, check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { productDefinitions } from "./platform-schema";

/** Canonical billing records are owned by FM Command; never by a SaaS or gateway. */
export const billingGatewayAccounts = pgTable("fmcc_billing_gateway_account", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  provider: text("provider").notNull(),
  environment: text("environment").notNull(),
  label: text("label").notNull(),
  secretRef: text("secret_ref").notNull(),
  status: text("status").notNull().default("disabled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_gateway_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("fmcc_billing_gateway_scope_label_uq").on(t.tenantId, t.provider, t.environment, t.label),
  check("fmcc_billing_gateway_env_ck", sql`${t.environment} in ('sandbox','production')`),
  check("fmcc_billing_gateway_status_ck", sql`${t.status} in ('disabled','enabled','revoked')`),
]);

export const billingCustomers = pgTable("fmcc_billing_customer", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  externalCustomerId: text("external_customer_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_customer_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("fmcc_billing_customer_external_uq").on(t.tenantId, t.externalCustomerId),
]);

export const billingProductPlans = pgTable("fmcc_billing_product_plan", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  planCode: text("plan_code").notNull(),
  name: text("name").notNull(),
  interval: text("interval").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("BRL"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_plan_scope_code_uq").on(t.tenantId, t.productId, t.planCode),
  foreignKey({ name: "fmcc_billing_plan_product_fk", columns: [t.tenantId,t.productId], foreignColumns: [productDefinitions.tenantId,productDefinitions.id] }),
  check("fmcc_billing_plan_interval_ck", sql`${t.interval} in ('monthly','yearly')`),
  check("fmcc_billing_plan_amount_ck", sql`${t.amountMinor} > 0`),
  check("fmcc_billing_plan_currency_ck", sql`${t.currency} = 'BRL'`),
  check("fmcc_billing_plan_status_ck", sql`${t.status} in ('active','inactive')`),
]);

export const billingCustomerBindings = pgTable("fmcc_billing_customer_binding", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  externalTenantId: text("external_tenant_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_customer_binding_external_uq").on(t.tenantId,t.productId,t.externalTenantId),
  uniqueIndex("fmcc_billing_customer_binding_customer_uq").on(t.tenantId,t.productId,t.customerId),
  foreignKey({ name: "fmcc_billing_customer_binding_product_fk", columns: [t.tenantId,t.productId], foreignColumns: [productDefinitions.tenantId,productDefinitions.id] }),
  foreignKey({ name: "fmcc_billing_customer_binding_customer_fk", columns: [t.tenantId,t.customerId], foreignColumns: [billingCustomers.tenantId,billingCustomers.id] }),
]);

export const billingProductRoutes = pgTable("fmcc_billing_product_route", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  gatewayAccountId: uuid("gateway_account_id").notNull(),
  status: text("status").notNull().default("disabled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_product_route_product_uq").on(t.tenantId,t.productId),
  foreignKey({ name: "fmcc_billing_product_route_product_fk", columns: [t.tenantId,t.productId], foreignColumns: [productDefinitions.tenantId,productDefinitions.id] }),
  foreignKey({ name: "fmcc_billing_product_route_gateway_fk", columns: [t.tenantId,t.gatewayAccountId], foreignColumns: [billingGatewayAccounts.tenantId,billingGatewayAccounts.id] }),
  check("fmcc_billing_product_route_status_ck", sql`${t.status} in ('disabled','enabled')`),
]);

export const billingSubscriptions = pgTable("fmcc_billing_subscription", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  planCode: text("plan_code").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_subscription_scope_uq").on(t.tenantId, t.id, t.productId, t.customerId),
  foreignKey({ name: "fmcc_billing_sub_product_fk", columns: [t.tenantId,t.productId], foreignColumns: [productDefinitions.tenantId, productDefinitions.id] }),
  foreignKey({ name: "fmcc_billing_sub_customer_fk", columns: [t.tenantId,t.customerId], foreignColumns: [billingCustomers.tenantId,billingCustomers.id] }),
  index("fmcc_billing_sub_customer_idx").on(t.tenantId, t.customerId),
]);

export const billingInvoices = pgTable("fmcc_billing_invoice", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull(),
  gatewayAccountId: uuid("gateway_account_id").notNull(),
  currency: text("currency").notNull().default("BRL"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_invoice_tenant_id_uq").on(t.tenantId, t.id),
  foreignKey({ name: "fmcc_billing_invoice_sub_fk", columns: [t.tenantId,t.subscriptionId,t.productId,t.customerId], foreignColumns: [billingSubscriptions.tenantId,billingSubscriptions.id,billingSubscriptions.productId,billingSubscriptions.customerId] }),
  foreignKey({ name: "fmcc_billing_invoice_gateway_fk", columns: [t.tenantId,t.gatewayAccountId], foreignColumns: [billingGatewayAccounts.tenantId,billingGatewayAccounts.id] }),
  check("fmcc_billing_invoice_amount_ck", sql`${t.amountMinor} > 0`),
  check("fmcc_billing_invoice_currency_ck", sql`${t.currency} = 'BRL'`),
  index("fmcc_billing_invoice_product_customer_idx").on(t.tenantId,t.productId,t.customerId),
]);

export const billingCommandRequests = pgTable("fmcc_billing_command_request", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  action: text("action").notNull(),
  payloadHash: text("payload_hash").notNull(),
  resultInvoiceId: uuid("result_invoice_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_command_idempotency_uq").on(t.tenantId,t.idempotencyKey),
  foreignKey({ name: "fmcc_billing_command_product_fk", columns: [t.tenantId,t.productId], foreignColumns: [productDefinitions.tenantId,productDefinitions.id] }),
  foreignKey({ name: "fmcc_billing_command_invoice_fk", columns: [t.tenantId,t.resultInvoiceId], foreignColumns: [billingInvoices.tenantId,billingInvoices.id] }),
  check("fmcc_billing_command_action_ck", sql`${t.action} in ('prepare_subscription_invoice')`),
]);

export const billingProviderPayments = pgTable("fmcc_billing_provider_payment", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  gatewayAccountId: uuid("gateway_account_id").notNull(),
  externalPaymentId: text("external_payment_id").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_provider_external_uq").on(t.tenantId,t.gatewayAccountId,t.externalPaymentId),
  uniqueIndex("fmcc_billing_provider_invoice_uq").on(t.tenantId,t.invoiceId),
  foreignKey({ name: "fmcc_billing_payment_invoice_fk", columns: [t.tenantId,t.invoiceId], foreignColumns: [billingInvoices.tenantId,billingInvoices.id] }),
  foreignKey({ name: "fmcc_billing_payment_gateway_fk", columns: [t.tenantId,t.gatewayAccountId], foreignColumns: [billingGatewayAccounts.tenantId,billingGatewayAccounts.id] }),
]);

export const billingGatewayEvents = pgTable("fmcc_billing_gateway_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  gatewayAccountId: uuid("gateway_account_id").notNull(),
  externalEventId: text("external_event_id").notNull(),
  status: text("status").notNull().default("received"),
  // Minimal immutable provider notification metadata. Never store raw payload,
  // credentials, PII, or treat a webhook as settlement proof.
  eventType: text("event_type"),
  externalPaymentId: text("external_payment_id"),
  externalReference: text("external_reference"),
  payloadFingerprint: text("payload_fingerprint"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", {withTimezone:true}).notNull().defaultNow(),
  leaseUntil: timestamp("lease_until", {withTimezone:true}),
  claimToken: uuid("claim_token"),
  lastErrorCode: text("last_error_code"),
  processedAt: timestamp("processed_at", {withTimezone:true}),
  updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_billing_gateway_event_dedupe_uq").on(t.tenantId,t.gatewayAccountId,t.externalEventId),
  index("fmcc_billing_gateway_event_queue_idx").on(t.tenantId,t.status,t.availableAt),
  foreignKey({ name: "fmcc_billing_event_gateway_fk", columns: [t.tenantId,t.gatewayAccountId], foreignColumns: [billingGatewayAccounts.tenantId,billingGatewayAccounts.id] }),
]);

export const billingAuditEvents = pgTable("fmcc_billing_audit_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  subjectId: text("subject_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("fmcc_billing_audit_scope_idx").on(t.tenantId,t.createdAt)]);

/**
 * Transactional FM-owned delivery ledger for IRON license transitions.
 * Only canonical payment/contract state may enqueue an event. It is not a
 * provider webhook inbox and not the source of entitlement authority.
 */
export const billingIronEntitlementOutbox = pgTable("fmcc_billing_iron_entitlement_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull(),
  eventType: text("event_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  claimToken: uuid("claim_token"),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
}, t => [
  uniqueIndex("fmcc_iron_outbox_dedupe_uq").on(t.tenantId, t.productId, t.idempotencyKey),
  index("fmcc_iron_outbox_ready_idx").on(t.status, t.availableAt),
  index("fmcc_iron_outbox_subscription_idx").on(t.tenantId, t.productId, t.subscriptionId),
  foreignKey({ name: "fmcc_iron_outbox_invoice_fk", columns: [t.tenantId, t.invoiceId], foreignColumns: [billingInvoices.tenantId, billingInvoices.id] }),
  foreignKey({ name: "fmcc_iron_outbox_product_fk", columns: [t.tenantId, t.productId], foreignColumns: [productDefinitions.tenantId, productDefinitions.id] }),
  check("fmcc_iron_outbox_event_ck", sql`${t.eventType} in ('LICENSE_ACTIVATE','LICENSE_SUSPEND','LICENSE_CANCEL')`),
  check("fmcc_iron_outbox_status_ck", sql`${t.status} in ('pending','processing','retry','delivered','blocked')`),
  check("fmcc_iron_outbox_attempts_ck", sql`${t.attempts} >= 0 and ${t.attempts} <= 12`),
]);

/**
 * One-way single-shot issuance reservation. An ambiguous provider POST can
 * never be retried by a second HTTP request. Recovery is GET-only.
 */
export const billingIronIssuanceClaims = pgTable("fmcc_billing_iron_issue_claim", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  gatewayAccountId: uuid("gateway_account_id").notNull(),
  externalCustomerId: text("external_customer_id").notNull(),
  externalReference: text("external_reference").notNull(),
  status: text("status").notNull().default("reserved"),
  externalPaymentId: text("external_payment_id"),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_iron_issue_invoice_uq").on(t.tenantId,t.invoiceId),
  uniqueIndex("fmcc_iron_issue_reference_uq").on(t.tenantId,t.gatewayAccountId,t.externalReference),
  foreignKey({name:"fmcc_iron_issue_invoice_fk",columns:[t.tenantId,t.invoiceId],foreignColumns:[billingInvoices.tenantId,billingInvoices.id]}),
  foreignKey({name:"fmcc_iron_issue_gateway_fk",columns:[t.tenantId,t.gatewayAccountId],foreignColumns:[billingGatewayAccounts.tenantId,billingGatewayAccounts.id]}),
  check("fmcc_iron_issue_status_ck", sql`${t.status} in ('reserved','uncertain','issued','blocked')`),
]);

/**
 * Canonical academy-to-Asaas payer enrollment. A reservation is persisted
 * before the one permitted provider POST. Legal identity documents are never
 * stored here. Recovery only performs provider GET.
 */
export const billingIronCustomerEnrollments = pgTable("fmcc_billing_iron_customer_enrollment", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  externalTenantId: text("external_tenant_id").notNull(),
  gatewayAccountId: uuid("gateway_account_id").notNull(),
  externalReference: text("external_reference").notNull(),
  status: text("status").notNull().default("reserved"),
  externalCustomerId: text("external_customer_id"),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("fmcc_iron_payer_academy_uq").on(t.tenantId,t.productId,t.externalTenantId),
  uniqueIndex("fmcc_iron_payer_provider_ref_uq").on(t.tenantId,t.gatewayAccountId,t.externalReference),
  foreignKey({name:"fmcc_iron_payer_product_fk",columns:[t.tenantId,t.productId],foreignColumns:[productDefinitions.tenantId,productDefinitions.id]}),
  foreignKey({name:"fmcc_iron_payer_customer_fk",columns:[t.tenantId,t.customerId],foreignColumns:[billingCustomers.tenantId,billingCustomers.id]}),
  foreignKey({name:"fmcc_iron_payer_gateway_fk",columns:[t.tenantId,t.gatewayAccountId],foreignColumns:[billingGatewayAccounts.tenantId,billingGatewayAccounts.id]}),
  check("fmcc_iron_payer_status_ck",sql`${t.status} in ('reserved','uncertain','enrolled','blocked')`),
]);
