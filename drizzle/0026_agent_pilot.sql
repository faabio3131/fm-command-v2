CREATE TABLE "fmcc_agent_budget" (
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"monthly_cap_micro_minor" bigint NOT NULL,
	"reserve_per_call_micro_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_agent_budget_tenant_id_agent_id_pk" PRIMARY KEY("tenant_id","agent_id"),
	CONSTRAINT "fmcc_agent_budget_ck" CHECK ("fmcc_agent_budget"."monthly_cap_micro_minor" >= 0 and "fmcc_agent_budget"."reserve_per_call_micro_minor" >= 0 and "fmcc_agent_budget"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "fmcc_agent_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"work_item_id" uuid,
	"input_lines" jsonb NOT NULL,
	"draft_subject" text,
	"draft_body" text,
	"final_subject" text,
	"final_body" text,
	"unverified_numbers" text[] DEFAULT '{}'::text[] NOT NULL,
	"cost_micro_minor" bigint,
	"currency" text,
	"error_code" text,
	"requested_by" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"sent_queued" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_agent_draft_status_ck" CHECK ("fmcc_agent_draft"."status" in ('generating','ready','failed','approved','rejected','sent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_agent_draft_live_uq" ON "fmcc_agent_draft" USING btree ("tenant_id","agent_id","period_key") WHERE "fmcc_agent_draft"."status" not in ('rejected','failed');--> statement-breakpoint
CREATE INDEX "fmcc_agent_draft_tenant_idx" ON "fmcc_agent_draft" USING btree ("tenant_id","created_at");