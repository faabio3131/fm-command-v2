import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Perfil regional da empresa cliente (ADR-020). Uma linha por empresa. */
export const orgProfiles = pgTable("fmcc_org_profile", {
  tenantId: text("tenant_id").primaryKey(),
  defaultLocale: text("default_locale").notNull(),
  countryCode: text("country_code").notNull(),
  currency: text("currency").notNull(),
  timezone: text("timezone").notNull(),
  dataRegion: text("data_region"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("fmcc_org_profile_country_ck", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
  check("fmcc_org_profile_currency_ck", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  check("fmcc_org_profile_region_ck", sql`${t.dataRegion} is null or ${t.dataRegion} in ('br','us','eu')`),
]);

/** Idioma escolhido pela pessoa. Vale em todas as empresas em que ela atua. */
export const userPreferences = pgTable("fmcc_user_preference", {
  userId: text("user_id").primaryKey(),
  locale: text("locale").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
