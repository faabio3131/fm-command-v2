CREATE TABLE "fmcc_billing_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"subject_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_billing_customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"external_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_billing_gateway_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"label" text NOT NULL,
	"secret_ref" text NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_billing_gateway_env_ck" CHECK ("fmcc_billing_gateway_account"."environment" in ('sandbox','production')),
	CONSTRAINT "fmcc_billing_gateway_status_ck" CHECK ("fmcc_billing_gateway_account"."status" in ('disabled','enabled','revoked'))
);
--> statement-breakpoint
CREATE TABLE "fmcc_billing_gateway_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"gateway_account_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_billing_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"gateway_account_id" uuid NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_billing_invoice_amount_ck" CHECK ("fmcc_billing_invoice"."amount_minor" > 0),
	CONSTRAINT "fmcc_billing_invoice_currency_ck" CHECK ("fmcc_billing_invoice"."currency" = 'BRL')
);
--> statement-breakpoint
CREATE TABLE "fmcc_billing_provider_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"gateway_account_id" uuid NOT NULL,
	"external_payment_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_billing_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fmcc_billing_audit_scope_idx" ON "fmcc_billing_audit_event" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_customer_tenant_id_uq" ON "fmcc_billing_customer" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_customer_external_uq" ON "fmcc_billing_customer" USING btree ("tenant_id","external_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_gateway_tenant_id_uq" ON "fmcc_billing_gateway_account" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_gateway_scope_label_uq" ON "fmcc_billing_gateway_account" USING btree ("tenant_id","provider","environment","label");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_gateway_event_dedupe_uq" ON "fmcc_billing_gateway_event" USING btree ("tenant_id","gateway_account_id","external_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_invoice_tenant_id_uq" ON "fmcc_billing_invoice" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "fmcc_billing_invoice_product_customer_idx" ON "fmcc_billing_invoice" USING btree ("tenant_id","product_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_provider_external_uq" ON "fmcc_billing_provider_payment" USING btree ("tenant_id","gateway_account_id","external_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_subscription_scope_uq" ON "fmcc_billing_subscription" USING btree ("tenant_id","id","product_id","customer_id");--> statement-breakpoint
CREATE INDEX "fmcc_billing_sub_customer_idx" ON "fmcc_billing_subscription" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_product_tenant_id_uq" ON "fmcc_product_definition" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD CONSTRAINT "fmcc_billing_event_gateway_fk" FOREIGN KEY ("tenant_id","gateway_account_id") REFERENCES "public"."fmcc_billing_gateway_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_invoice" ADD CONSTRAINT "fmcc_billing_invoice_sub_fk" FOREIGN KEY ("tenant_id","subscription_id","product_id","customer_id") REFERENCES "public"."fmcc_billing_subscription"("tenant_id","id","product_id","customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_invoice" ADD CONSTRAINT "fmcc_billing_invoice_gateway_fk" FOREIGN KEY ("tenant_id","gateway_account_id") REFERENCES "public"."fmcc_billing_gateway_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_provider_payment" ADD CONSTRAINT "fmcc_billing_payment_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."fmcc_billing_invoice"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_provider_payment" ADD CONSTRAINT "fmcc_billing_payment_gateway_fk" FOREIGN KEY ("tenant_id","gateway_account_id") REFERENCES "public"."fmcc_billing_gateway_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_subscription" ADD CONSTRAINT "fmcc_billing_sub_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."fmcc_product_definition"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_subscription" ADD CONSTRAINT "fmcc_billing_sub_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."fmcc_billing_customer"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
