ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "event_type" text;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "external_payment_id" text;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "external_reference" text;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "payload_fingerprint" text;
