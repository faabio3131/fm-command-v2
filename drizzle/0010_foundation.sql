ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "available_at" timestamptz DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "lease_until" timestamptz;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "claim_token" uuid;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "last_error_code" text;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "processed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_gateway_event" ADD COLUMN "updated_at" timestamptz DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX "fmcc_billing_gateway_event_queue_idx" ON "fmcc_billing_gateway_event" USING btree ("tenant_id","status","available_at");