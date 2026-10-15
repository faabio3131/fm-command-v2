CREATE TABLE "fmcc_billing_command_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"action" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_billing_command_action_ck" CHECK ("fmcc_billing_command_request"."action" in ('prepare_subscription_invoice'))
);
--> statement-breakpoint
CREATE TABLE "fmcc_billing_customer_binding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"external_tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_billing_product_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"name" text NOT NULL,
	"interval" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_billing_plan_interval_ck" CHECK ("fmcc_billing_product_plan"."interval" in ('monthly','yearly')),
	CONSTRAINT "fmcc_billing_plan_amount_ck" CHECK ("fmcc_billing_product_plan"."amount_minor" > 0),
	CONSTRAINT "fmcc_billing_plan_currency_ck" CHECK ("fmcc_billing_product_plan"."currency" = 'BRL'),
	CONSTRAINT "fmcc_billing_plan_status_ck" CHECK ("fmcc_billing_product_plan"."status" in ('active','inactive'))
);
--> statement-breakpoint
CREATE TABLE "fmcc_billing_product_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"gateway_account_id" uuid NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_billing_product_route_status_ck" CHECK ("fmcc_billing_product_route"."status" in ('disabled','enabled'))
);
--> statement-breakpoint
ALTER TABLE "fmcc_billing_command_request" ADD CONSTRAINT "fmcc_billing_command_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."fmcc_product_definition"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_command_request" ADD CONSTRAINT "fmcc_billing_command_invoice_fk" FOREIGN KEY ("tenant_id","result_invoice_id") REFERENCES "public"."fmcc_billing_invoice"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_customer_binding" ADD CONSTRAINT "fmcc_billing_customer_binding_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."fmcc_product_definition"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_customer_binding" ADD CONSTRAINT "fmcc_billing_customer_binding_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."fmcc_billing_customer"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_product_plan" ADD CONSTRAINT "fmcc_billing_plan_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."fmcc_product_definition"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_product_route" ADD CONSTRAINT "fmcc_billing_product_route_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."fmcc_product_definition"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_billing_product_route" ADD CONSTRAINT "fmcc_billing_product_route_gateway_fk" FOREIGN KEY ("tenant_id","gateway_account_id") REFERENCES "public"."fmcc_billing_gateway_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_command_idempotency_uq" ON "fmcc_billing_command_request" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_customer_binding_external_uq" ON "fmcc_billing_customer_binding" USING btree ("tenant_id","product_id","external_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_customer_binding_customer_uq" ON "fmcc_billing_customer_binding" USING btree ("tenant_id","product_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_plan_scope_code_uq" ON "fmcc_billing_product_plan" USING btree ("tenant_id","product_id","plan_code");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_billing_product_route_product_uq" ON "fmcc_billing_product_route" USING btree ("tenant_id","product_id");