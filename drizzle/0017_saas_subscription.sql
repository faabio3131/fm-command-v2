CREATE TABLE "fmcc_saas_event" (
	"provider_id" text NOT NULL,
	"event_id" text NOT NULL,
	"subscription_id" uuid,
	"subscription_ref" text NOT NULL,
	"amount_minor" integer,
	"currency" text,
	"type" text NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_saas_payment_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"currency" text NOT NULL,
	"country" text,
	"provider_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fmcc_saas_payment_route_currency_ck" CHECK ("fmcc_saas_payment_route"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fmcc_saas_payment_route_country_ck" CHECK ("fmcc_saas_payment_route"."country" is null or "fmcc_saas_payment_route"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "fmcc_saas_plan_price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" text NOT NULL,
	"currency" text NOT NULL,
	"country" text,
	"amount_minor" integer NOT NULL,
	"interval" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fmcc_saas_plan_price_amount_ck" CHECK ("fmcc_saas_plan_price"."amount_minor" > 0),
	CONSTRAINT "fmcc_saas_plan_price_currency_ck" CHECK ("fmcc_saas_plan_price"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fmcc_saas_plan_price_country_ck" CHECK ("fmcc_saas_plan_price"."country" is null or "fmcc_saas_plan_price"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "fmcc_saas_plan_price_interval_ck" CHECK ("fmcc_saas_plan_price"."interval" in ('month','year'))
);
--> statement-breakpoint
CREATE TABLE "fmcc_saas_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_saas_plan_id_ck" CHECK ("fmcc_saas_plan"."id" ~ '^[a-z0-9][a-z0-9_-]{1,62}$')
);
--> statement-breakpoint
CREATE TABLE "fmcc_saas_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"price_amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"interval" text NOT NULL,
	"state" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_customer_ref" text,
	"provider_subscription_ref" text,
	"checkout_url" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_event_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_saas_subscription_state_ck" CHECK ("fmcc_saas_subscription"."state" in ('creating','pending','active','past_due','cancelled','failed')),
	CONSTRAINT "fmcc_saas_subscription_amount_ck" CHECK ("fmcc_saas_subscription"."price_amount_minor" > 0),
	CONSTRAINT "fmcc_saas_subscription_interval_ck" CHECK ("fmcc_saas_subscription"."interval" in ('month','year'))
);
--> statement-breakpoint
ALTER TABLE "fmcc_saas_plan_price" ADD CONSTRAINT "fmcc_saas_plan_price_plan_id_fmcc_saas_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."fmcc_saas_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_saas_subscription" ADD CONSTRAINT "fmcc_saas_subscription_plan_id_fmcc_saas_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."fmcc_saas_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_saas_event_uq" ON "fmcc_saas_event" USING btree ("provider_id","event_id");--> statement-breakpoint
CREATE INDEX "fmcc_saas_event_subscription_idx" ON "fmcc_saas_event" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "fmcc_saas_event_unmatched_idx" ON "fmcc_saas_event" USING btree ("provider_id","subscription_ref") WHERE "fmcc_saas_event"."outcome" = 'unmatched';--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_saas_payment_route_uq" ON "fmcc_saas_payment_route" USING btree ("currency",coalesce("country", '*'));--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_saas_plan_price_uq" ON "fmcc_saas_plan_price" USING btree ("plan_id","currency",coalesce("country", '*'),"interval") WHERE "fmcc_saas_plan_price"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_saas_subscription_idem_uq" ON "fmcc_saas_subscription" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_saas_subscription_live_uq" ON "fmcc_saas_subscription" USING btree ("tenant_id") WHERE "fmcc_saas_subscription"."state" in ('creating','pending','active','past_due');--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_saas_subscription_provider_ref_uq" ON "fmcc_saas_subscription" USING btree ("provider_id","provider_subscription_ref") WHERE "fmcc_saas_subscription"."provider_subscription_ref" is not null;--> statement-breakpoint
CREATE INDEX "fmcc_saas_subscription_tenant_idx" ON "fmcc_saas_subscription" USING btree ("tenant_id","created_at");