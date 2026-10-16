import { isCurrencyCode } from "@/domain/core/money";
import { fail, ok, type Validation } from "@/domain/core/result";
import { isSupportedLocale, type Locale } from "@/i18n/locales";

/** Perfil regional da empresa cliente (ADR-020): idioma padrão, país, moeda, fuso e região dos dados. */
export interface OrgProfile {
  readonly tenantId: string;
  readonly defaultLocale: Locale;
  readonly countryCode: string;
  readonly currency: string;
  readonly timezone: string;
  /** Região onde os dados da empresa ficam. Hoje é só um registro; a separação física é decisão futura. */
  readonly dataRegion: string | null;
}

export const DATA_REGIONS = ["br", "us", "eu"] as const;

function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

export function validateOrgProfile(input: {
  tenantId: string; defaultLocale: unknown; countryCode: unknown; currency: unknown; timezone: unknown; dataRegion?: unknown;
}): Validation<OrgProfile> {
  const errors: string[] = [];
  if (!input.tenantId.trim()) errors.push("profile.tenant_required");
  if (!isSupportedLocale(input.defaultLocale)) errors.push("profile.locale_not_supported");
  if (typeof input.countryCode !== "string" || !/^[A-Z]{2}$/.test(input.countryCode)) errors.push("profile.country_must_be_iso_3166_alpha2");
  if (!isCurrencyCode(input.currency)) errors.push("profile.currency_must_be_iso_4217");
  if (!validTimezone(input.timezone)) errors.push("profile.timezone_must_be_iana");
  const region = input.dataRegion ?? null;
  if (region !== null && !(DATA_REGIONS as readonly unknown[]).includes(region)) errors.push("profile.data_region_unknown");
  if (errors.length > 0) return fail(...errors);
  return ok({
    tenantId: input.tenantId, defaultLocale: input.defaultLocale as Locale, countryCode: input.countryCode as string,
    currency: input.currency as string, timezone: input.timezone as string, dataRegion: region as string | null,
  });
}
