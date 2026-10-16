CREATE TABLE "fmcc_sector_pack" (
	"tenant_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"pack_version" integer NOT NULL,
	"enabled_by" text NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_sector_pack_tenant_id_pack_id_pk" PRIMARY KEY("tenant_id","pack_id")
);
--> statement-breakpoint
CREATE INDEX "fmcc_sector_pack_tenant_idx" ON "fmcc_sector_pack" USING btree ("tenant_id");