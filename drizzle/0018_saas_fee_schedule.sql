CREATE TABLE "fmcc_saas_fee_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"method" text NOT NULL,
	"currency" text NOT NULL,
	"fixed_minor" integer DEFAULT 0 NOT NULL,
	"percent_bps" integer DEFAULT 0 NOT NULL,
	"min_minor" integer DEFAULT 0 NOT NULL,
	"max_minor" integer,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fmcc_saas_fee_schedule_method_ck" CHECK ("fmcc_saas_fee_schedule"."method" in ('boleto','pix','card','transfer','other')),
	CONSTRAINT "fmcc_saas_fee_schedule_currency_ck" CHECK ("fmcc_saas_fee_schedule"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fmcc_saas_fee_schedule_amounts_ck" CHECK ("fmcc_saas_fee_schedule"."fixed_minor" >= 0 and "fmcc_saas_fee_schedule"."min_minor" >= 0 and ("fmcc_saas_fee_schedule"."max_minor" is null or "fmcc_saas_fee_schedule"."max_minor" >= "fmcc_saas_fee_schedule"."min_minor")),
	CONSTRAINT "fmcc_saas_fee_schedule_percent_ck" CHECK ("fmcc_saas_fee_schedule"."percent_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_saas_fee_schedule_uq" ON "fmcc_saas_fee_schedule" USING btree ("provider_id","method","currency","effective_from");