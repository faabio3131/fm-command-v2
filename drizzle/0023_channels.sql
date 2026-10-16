CREATE TABLE "fmcc_channel_config" (
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider_id" text NOT NULL,
	"secret_ref" text,
	"sender" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"min_severity" text DEFAULT 'warning' NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_channel_config_tenant_id_kind_pk" PRIMARY KEY("tenant_id","kind"),
	CONSTRAINT "fmcc_channel_config_kind_ck" CHECK ("fmcc_channel_config"."kind" in ('email','whatsapp')),
	CONSTRAINT "fmcc_channel_config_severity_ck" CHECK ("fmcc_channel_config"."min_severity" in ('info','warning','critical'))
);
--> statement-breakpoint
CREATE TABLE "fmcc_channel_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider_id" text NOT NULL,
	"recipient" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"attempt_started_at" timestamp with time zone,
	"provider_message_id" text,
	"error_code" text,
	"subject" text,
	"content_hash" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "fmcc_channel_delivery_status_ck" CHECK ("fmcc_channel_delivery"."status" in ('pending','sending','sent','failed_transient','failed','uncertain'))
);
--> statement-breakpoint
CREATE TABLE "fmcc_channel_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"address" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_channel_recipient_kind_ck" CHECK ("fmcc_channel_recipient"."kind" in ('email','whatsapp'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_channel_delivery_dedupe_uq" ON "fmcc_channel_delivery" USING btree ("tenant_id","kind","recipient","dedupe_key");--> statement-breakpoint
CREATE INDEX "fmcc_channel_delivery_due_idx" ON "fmcc_channel_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "fmcc_channel_delivery_tenant_time_idx" ON "fmcc_channel_delivery" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_channel_recipient_uq" ON "fmcc_channel_recipient" USING btree ("tenant_id","kind","address");--> statement-breakpoint
CREATE INDEX "fmcc_channel_recipient_tenant_idx" ON "fmcc_channel_recipient" USING btree ("tenant_id","kind");