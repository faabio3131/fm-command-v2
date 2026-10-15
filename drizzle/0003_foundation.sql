CREATE TABLE "fmcc_monitored_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"service_type" text NOT NULL,
	"authority" text NOT NULL,
	"environment" text NOT NULL,
	"expected_health_contract" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_service_health_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"service_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"availability" text,
	"latency_p95_ms" integer,
	"error_rate" text,
	"source_authority" text NOT NULL,
	"freshness_status" text NOT NULL,
	"provenance_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_monitored_service_tenant_name_env_uq" ON "fmcc_monitored_service" USING btree ("tenant_id","name","environment");--> statement-breakpoint
CREATE INDEX "fmcc_monitored_service_tenant_product_idx" ON "fmcc_monitored_service" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "fmcc_service_health_tenant_service_time_idx" ON "fmcc_service_health_observation" USING btree ("tenant_id","service_id","observed_at");