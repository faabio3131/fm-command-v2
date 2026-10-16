CREATE TABLE "fmcc_source_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"secret_ref" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_source_credential_ref_uq" ON "fmcc_source_credential" USING btree ("tenant_id","secret_ref");--> statement-breakpoint
CREATE INDEX "fmcc_source_credential_tenant_idx" ON "fmcc_source_credential" USING btree ("tenant_id");