CREATE TABLE "fmcc_canonical_fact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"fact_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"mapping_version" text NOT NULL,
	"source_timestamp" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_metric_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"metric_id" text NOT NULL,
	"metric_version" integer NOT NULL,
	"value" text,
	"unit" text NOT NULL,
	"currency" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"as_of" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_timestamp" timestamp with time zone,
	"freshness_status" text NOT NULL,
	"quality_status" text NOT NULL,
	"source_authority" text NOT NULL,
	"provenance_refs" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_source_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"authoritative_domain" text NOT NULL,
	"status" text DEFAULT 'configured' NOT NULL,
	"sync_mode" text NOT NULL,
	"secret_ref" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"freshness_seconds" integer,
	"mapping_version" text DEFAULT 'v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_sync_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text NOT NULL,
	"cursor_before" text,
	"cursor_after" text,
	"idempotency_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_fact_dedupe_uq" ON "fmcc_canonical_fact" USING btree ("tenant_id","source_id","external_id","mapping_version");--> statement-breakpoint
CREATE INDEX "fmcc_fact_tenant_type_time_idx" ON "fmcc_canonical_fact" USING btree ("tenant_id","fact_type","source_timestamp");--> statement-breakpoint
CREATE INDEX "fmcc_metric_tenant_metric_time_idx" ON "fmcc_metric_value" USING btree ("tenant_id","metric_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_source_tenant_name_uq" ON "fmcc_source_definition" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "fmcc_source_tenant_status_idx" ON "fmcc_source_definition" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_sync_tenant_idempotency_uq" ON "fmcc_sync_execution" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "fmcc_sync_tenant_source_idx" ON "fmcc_sync_execution" USING btree ("tenant_id","source_id","started_at");