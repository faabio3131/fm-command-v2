CREATE TABLE "fmcc_org_profile" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"default_locale" text NOT NULL,
	"country_code" text NOT NULL,
	"currency" text NOT NULL,
	"timezone" text NOT NULL,
	"data_region" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fmcc_org_profile_country_ck" CHECK ("fmcc_org_profile"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "fmcc_org_profile_currency_ck" CHECK ("fmcc_org_profile"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fmcc_org_profile_region_ck" CHECK ("fmcc_org_profile"."data_region" is null or "fmcc_org_profile"."data_region" in ('br','us','eu'))
);
--> statement-breakpoint
CREATE TABLE "fmcc_user_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"locale" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
