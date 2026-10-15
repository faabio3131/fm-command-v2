CREATE TABLE "fmcc_work_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"unit_id" uuid,
	"task_type" text NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"locale" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"worker_id" text,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "fmcc_work_item_state_ck" CHECK ("fmcc_work_item"."state" in ('queued','running','succeeded','dead','expired')),
	CONSTRAINT "fmcc_work_item_type_ck" CHECK ("fmcc_work_item"."task_type" in ('analysis','synthesis','attendance','transcription','decision')),
	CONSTRAINT "fmcc_work_item_priority_ck" CHECK ("fmcc_work_item"."priority" between 0 and 100),
	CONSTRAINT "fmcc_work_item_attempts_ck" CHECK ("fmcc_work_item"."max_attempts" >= 1 and "fmcc_work_item"."attempt" >= 0 and "fmcc_work_item"."attempt" <= "fmcc_work_item"."max_attempts"),
	CONSTRAINT "fmcc_work_item_lease_ck" CHECK (("fmcc_work_item"."state" = 'running') = ("fmcc_work_item"."lease_token" is not null and "fmcc_work_item"."lease_until" is not null))
);
--> statement-breakpoint
ALTER TABLE "fmcc_work_item" ADD CONSTRAINT "fmcc_work_item_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."fmcc_org_unit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_work_item_idem_uq" ON "fmcc_work_item" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "fmcc_work_item_queued_head_idx" ON "fmcc_work_item" USING btree ("tenant_id","priority" desc,"run_after","created_at") WHERE "fmcc_work_item"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "fmcc_work_item_running_lease_idx" ON "fmcc_work_item" USING btree ("lease_until") WHERE "fmcc_work_item"."state" = 'running';--> statement-breakpoint
CREATE INDEX "fmcc_work_item_running_tenant_idx" ON "fmcc_work_item" USING btree ("tenant_id") WHERE "fmcc_work_item"."state" = 'running';