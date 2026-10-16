CREATE TABLE "fmcc_oauth_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"verifier_ciphertext" text,
	"verifier_iv" text,
	"verifier_auth_tag" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_oauth_state_hash_uq" ON "fmcc_oauth_state" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "fmcc_oauth_state_tenant_idx" ON "fmcc_oauth_state" USING btree ("tenant_id");