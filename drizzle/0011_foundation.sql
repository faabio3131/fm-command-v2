CREATE TABLE "fmcc_billing_iron_customer_enrollment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "product_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "external_tenant_id" text NOT NULL,
  "gateway_account_id" uuid NOT NULL,
  "external_reference" text NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "external_customer_id" text,
  "last_error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fmcc_iron_payer_status_ck" CHECK ("fmcc_billing_iron_customer_enrollment"."status" in ('reserved','uncertain','enrolled','blocked'))
);
--> statement-breakpoint
ALTER TABLE "fmcc_billing_iron_customer_enrollment" ADD CONSTRAINT "fmcc_iron_payer_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."fmcc_product_definition"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_iron_customer_enrollment" ADD CONSTRAINT "fmcc_iron_payer_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."fmcc_billing_customer"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_iron_customer_enrollment" ADD CONSTRAINT "fmcc_iron_payer_gateway_fk" FOREIGN KEY ("tenant_id","gateway_account_id") REFERENCES "public"."fmcc_billing_gateway_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_iron_payer_academy_uq" ON "fmcc_billing_iron_customer_enrollment" USING btree ("tenant_id","product_id","external_tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_iron_payer_provider_ref_uq" ON "fmcc_billing_iron_customer_enrollment" USING btree ("tenant_id","gateway_account_id","external_reference");