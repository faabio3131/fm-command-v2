DROP INDEX "fmcc_saas_payment_route_uq";--> statement-breakpoint
ALTER TABLE "fmcc_saas_payment_route" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_saas_payment_route_provider_uq" ON "fmcc_saas_payment_route" USING btree ("currency",coalesce("country", '*'),"provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_saas_payment_route_uq" ON "fmcc_saas_payment_route" USING btree ("currency",coalesce("country", '*'),"priority");--> statement-breakpoint
ALTER TABLE "fmcc_saas_payment_route" ADD CONSTRAINT "fmcc_saas_payment_route_priority_ck" CHECK ("fmcc_saas_payment_route"."priority" >= 0);