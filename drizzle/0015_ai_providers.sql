CREATE TABLE "fmcc_ai_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'openai_compatible' NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"secret_ref" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"currency" text NOT NULL,
	"input_minor_per_million" integer DEFAULT 0 NOT NULL,
	"output_minor_per_million" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_ai_provider_kind_ck" CHECK ("fmcc_ai_provider"."kind" in ('openai_compatible')),
	CONSTRAINT "fmcc_ai_provider_secret_ck" CHECK ("fmcc_ai_provider"."secret_ref" ~ '^env://AI_KEY_[A-Z0-9_]{1,56}$'),
	CONSTRAINT "fmcc_ai_provider_timeout_ck" CHECK ("fmcc_ai_provider"."timeout_ms" between 1000 and 120000),
	CONSTRAINT "fmcc_ai_provider_currency_ck" CHECK ("fmcc_ai_provider"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fmcc_ai_provider_price_ck" CHECK ("fmcc_ai_provider"."input_minor_per_million" between 0 and 100000000 and "fmcc_ai_provider"."output_minor_per_million" between 0 and 100000000)
);
--> statement-breakpoint
CREATE TABLE "fmcc_ai_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_type" text NOT NULL,
	"tenant_id" text,
	"provider_id" text NOT NULL,
	"role" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"max_concurrent" integer DEFAULT 8 NOT NULL,
	CONSTRAINT "fmcc_ai_route_type_ck" CHECK ("fmcc_ai_route"."task_type" in ('analysis','synthesis','attendance','transcription','decision')),
	CONSTRAINT "fmcc_ai_route_role_ck" CHECK ("fmcc_ai_route"."role" in ('primary','reserve')),
	CONSTRAINT "fmcc_ai_route_weight_ck" CHECK ("fmcc_ai_route"."weight" >= 1 and "fmcc_ai_route"."max_concurrent" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fmcc_ai_tenant_policy" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"allowed_providers" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fmcc_ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"unit_id" uuid,
	"task_id" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"task_type" text NOT NULL,
	"provider_id" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" bigint NOT NULL,
	"tokens_out" bigint NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"cost_micro_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_ai_usage_nonneg_ck" CHECK ("fmcc_ai_usage"."tokens_in" >= 0 and "fmcc_ai_usage"."tokens_out" >= 0 and "fmcc_ai_usage"."cost_micro_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fmcc_ai_route" ADD CONSTRAINT "fmcc_ai_route_provider_id_fmcc_ai_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."fmcc_ai_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fmcc_ai_usage" ADD CONSTRAINT "fmcc_ai_usage_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."fmcc_org_unit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_ai_route_uq" ON "fmcc_ai_route" USING btree (coalesce("tenant_id", ''),"task_type","provider_id");--> statement-breakpoint
CREATE INDEX "fmcc_ai_route_task_idx" ON "fmcc_ai_route" USING btree ("task_type");--> statement-breakpoint
CREATE UNIQUE INDEX "fmcc_ai_usage_call_uq" ON "fmcc_ai_usage" USING btree ("task_id","attempt","provider_id");--> statement-breakpoint
CREATE INDEX "fmcc_ai_usage_tenant_time_idx" ON "fmcc_ai_usage" USING btree ("tenant_id","occurred_at");