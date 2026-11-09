ALTER TABLE "fmcc_billing_subscription" ADD COLUMN "paid_through" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "fmcc_billing_invoice" ADD COLUMN "period_end" timestamp with time zone;
