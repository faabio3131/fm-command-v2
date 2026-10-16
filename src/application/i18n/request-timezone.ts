import { PostgresProfileRepository } from "@/infrastructure/i18n/postgres-profile-repository";

/** Fuso usado para mostrar datas quando a empresa ainda não configurou o perfil. */
export const FALLBACK_TIME_ZONE = "UTC";

/**
 * Fuso da empresa para formatar datas na tela. Vem do perfil da empresa (nunca fixo no código).
 * Nunca lança erro: sem perfil ou sem banco, usa UTC para a tela não cair.
 */
export async function getCompanyTimeZone(tenantId: string): Promise<string> {
  try {
    const profile = await new PostgresProfileRepository().getOrgProfile(tenantId);
    return profile?.timezone || FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}
