import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { orgProfiles, userPreferences } from "@/infrastructure/db/profile-schema";
import { validateOrgProfile, type OrgProfile } from "@/domain/organization/org-profile";
import { isSupportedLocale, type Locale } from "@/i18n/locales";

export class ProfileValidationError extends Error {
  constructor(readonly errors: readonly string[]) { super(`i18n.profile_invalid:${errors.join(",")}`); }
}

export class PostgresProfileRepository {
  async getOrgProfile(tenantId: string): Promise<OrgProfile | null> {
    const rows = await db.select().from(orgProfiles).where(eq(orgProfiles.tenantId, tenantId)).limit(1);
    const r = rows[0];
    if (!r) return null;
    const checked = validateOrgProfile({ ...r, dataRegion: r.dataRegion });
    return checked.ok ? checked.value : null; // linha inválida (escrita direta no banco) é tratada como ausente
  }

  async saveOrgProfile(input: {
    tenantId: string; defaultLocale: unknown; countryCode: unknown; currency: unknown; timezone: unknown; dataRegion?: unknown; updatedBy: string;
  }): Promise<OrgProfile> {
    const checked = validateOrgProfile(input);
    if (!checked.ok) throw new ProfileValidationError(checked.errors);
    const p = checked.value;
    await db.insert(orgProfiles).values({ ...p, updatedBy: input.updatedBy }).onConflictDoUpdate({
      target: orgProfiles.tenantId,
      set: { defaultLocale: p.defaultLocale, countryCode: p.countryCode, currency: p.currency, timezone: p.timezone, dataRegion: p.dataRegion, updatedBy: input.updatedBy, updatedAt: new Date() },
    });
    return p;
  }

  async getUserLocale(userId: string): Promise<Locale | null> {
    const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    return isSupportedLocale(rows[0]?.locale) ? rows[0].locale : null;
  }

  async setUserLocale(userId: string, locale: unknown): Promise<Locale> {
    if (!isSupportedLocale(locale)) throw new ProfileValidationError(["profile.locale_not_supported"]);
    await db.insert(userPreferences).values({ userId, locale }).onConflictDoUpdate({
      target: userPreferences.userId, set: { locale, updatedAt: new Date() },
    });
    return locale;
  }
}
