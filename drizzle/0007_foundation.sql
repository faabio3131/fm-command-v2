CREATE TABLE "fmcc_billing_iron_entitlement_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"claim_token" uuid,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "fmcc_iron_outbox_event_ck" CHECK ("fmcc_billing_iron_entitlement_outbox"."event_type" in ('LICENSE_ACTIVATE','LICENSE_SUSPEND','LICENSE_CANCEL')),
	CONSTRAINT "fmcc_iron_outbox_status_ck" CHECK ("fmcc_billing_iron_entitlement_outbox"."status" in ('pending','processing','retry','delivered','blocked')),
	CONSTRAINT "fmcc_iron_outbox_attempts_ck" CHECK ("fmcc_billing_iron_entitlement_outbox"."attempts" >= 0 and "fmcc_billing_iron_entitlement_outbox"."attempts" <= 12)
);
--> statement-breakpoint
ALTER TABLE "fmcc_billing_iron_entitlement_outbox" ADD CONSTRAINT "fmcc_iron_outbox_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."fmcc_billing_invoice"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_iron_entitlement_outbox" ADD CONSTRAINT "fmcc_iron_outbox_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."fmcc_product_definition"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_iron_outbox_dedupe_uq" ON "fmcc_billing_iron_entitlement_outbox" USING btree ("tenant_id","product_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "fmcc_iron_outbox_ready_idx" ON "fmcc_billing_iron_entitlement_outbox" USING btree ("status","available_at");
--> statement-breakpoint
CREATE INDEX "fmcc_iron_outbox_subscription_idx" ON "fmcc_billing_iron_entitlement_outbox" USING btree ("tenant_id","product_id","subscription_id");