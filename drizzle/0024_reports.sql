CREATE TABLE "fmcc_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"metric_ids" jsonb NOT NULL,
	"frequency" text NOT NULL,
	"hour" integer NOT NULL,
	"weekday" integer DEFAULT 1 NOT NULL,
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_period_key" text,
	"last_run_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_report_frequency_ck" CHECK ("fmcc_report"."frequency" in ('daily','weekly','monthly')),
	CONSTRAINT "fmcc_report_hour_ck" CHECK ("fmcc_report"."hour" between 0 and 23),
	CONSTRAINT "fmcc_report_weekday_ck" CHECK ("fmcc_report"."weekday" between 0 and 6),
	CONSTRAINT "fmcc_report_dom_ck" CHECK ("fmcc_report"."day_of_month" between 1 and 28)
);
--> statement-breakpoint
CREATE INDEX "fmcc_report_tenant_idx" ON "fmcc_report" USING btree ("tenant_id");