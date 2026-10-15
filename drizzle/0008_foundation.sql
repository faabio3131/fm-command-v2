CREATE TABLE "fmcc_billing_iron_issue_claim" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "product_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "gateway_account_id" uuid NOT NULL,
  "external_customer_id" text NOT NULL,
  "external_reference" text NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "external_payment_id" text,
  "last_error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fmcc_iron_issue_status_ck" CHECK ("fmcc_billing_iron_issue_claim"."status" in ('reserved','uncertain','issued','blocked'))
);
--> statement-breakpoint
ALTER TABLE "fmcc_billing_iron_issue_claim" ADD CONSTRAINT "fmcc_iron_issue_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."fmcc_billing_invoice"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_iron_issue_claim" ADD CONSTRAINT "fmcc_iron_issue_gateway_fk" FOREIGN KEY ("tenant_id","gateway_account_id") REFERENCES "public"."fmcc_billing_gateway_account"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_iron_issue_invoice_uq" ON "fmcc_billing_iron_issue_claim" USING btree ("tenant_id","invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_iron_issue_reference_uq" ON "fmcc_billing_iron_issue_claim" USING btree ("tenant_id","gateway_account_id","external_reference");