CREATE TABLE "fmcc_org_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"country_code" text,
	"timezone" text,
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_org_unit_kind_ck" CHECK ("fmcc_org_unit"."kind" in ('company','region','branch')),
	CONSTRAINT "fmcc_org_unit_company_root_ck" CHECK (("fmcc_org_unit"."kind" = 'company') = ("fmcc_org_unit"."parent_id" is null)),
	CONSTRAINT "fmcc_org_unit_not_self_parent_ck" CHECK ("fmcc_org_unit"."parent_id" is distinct from "fmcc_org_unit"."id"),
	CONSTRAINT "fmcc_org_unit_country_ck" CHECK ("fmcc_org_unit"."country_code" is null or "fmcc_org_unit"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "fmcc_org_unit_currency_ck" CHECK ("fmcc_org_unit"."currency" is null or "fmcc_org_unit"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
-- O indice unico (tenant_id, id) precisa existir antes das chaves estrangeiras compostas que o referenciam.
CREATE UNIQUE INDEX "fmcc_org_unit_tenant_id_uq" ON "fmcc_org_unit" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE TABLE "fmcc_unit_grant" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_unit_grant_tenant_id_user_id_unit_id_pk" PRIMARY KEY("tenant_id","user_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "fmcc_canonical_fact" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "fmcc_metric_value" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "fmcc_org_unit" ADD CONSTRAINT "fmcc_org_unit_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."fmcc_org_unit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_unit_grant" ADD CONSTRAINT "fmcc_unit_grant_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."fmcc_org_unit"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_org_unit_one_company_uq" ON "fmcc_org_unit" USING btree ("tenant_id") WHERE "fmcc_org_unit"."kind" = 'company';--> statement-breakpoint
CREATE INDEX "fmcc_org_unit_tenant_parent_idx" ON "fmcc_org_unit" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "fmcc_unit_grant_tenant_user_idx" ON "fmcc_unit_grant" USING btree ("tenant_id","user_id");--> statement-breakpoint
ALTER TABLE "fmcc_canonical_fact" ADD CONSTRAINT "fmcc_fact_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."fmcc_org_unit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_metric_value" ADD CONSTRAINT "fmcc_metric_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."fmcc_org_unit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fmcc_fact_tenant_unit_type_time_idx" ON "fmcc_canonical_fact" USING btree ("tenant_id","unit_id","fact_type","source_timestamp");--> statement-breakpoint
CREATE INDEX "fmcc_metric_tenant_unit_metric_time_idx" ON "fmcc_metric_value" USING btree ("tenant_id","unit_id","metric_id","computed_at");