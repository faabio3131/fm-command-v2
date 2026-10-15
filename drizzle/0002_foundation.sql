CREATE TABLE "fmcc_product_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fmcc_source_definition" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "fmcc_canonical_fact" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "fmcc_metric_value" ADD COLUMN "product_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_product_tenant_slug_uq" ON "fmcc_product_definition" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "fmcc_product_tenant_status_idx" ON "fmcc_product_definition" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "fmcc_source_tenant_product_idx" ON "fmcc_source_definition" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "fmcc_fact_tenant_product_type_time_idx" ON "fmcc_canonical_fact" USING btree ("tenant_id","product_id","fact_type","source_timestamp");--> statement-breakpoint
CREATE INDEX "fmcc_metric_tenant_product_metric_time_idx" ON "fmcc_metric_value" USING btree ("tenant_id","product_id","metric_id","computed_at");
