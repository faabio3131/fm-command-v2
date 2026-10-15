import { cache } from "react";
import { cookies, headers } from "next/headers";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { PostgresProfileRepository } from "@/infrastructure/i18n/postgres-profile-repository";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "@/i18n/locales";

/**
 * Idioma desta requisição. Com sessão: escolha salva da pessoa, depois padrão da empresa.
 * Sem sessão (ou se o banco falhar): cookie do seletor, depois navegador, depois padrão global.
 * Nunca lança erro: um problema aqui não pode derrubar a tela.
 */
export const getRequestLocale = cache(async (): Promise<Locale> => {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  let userChoice: string | null = jar.get(LOCALE_COOKIE)?.value ?? null;
  let organizationDefault: string | null = null;
  try {
    const context = await resolveTenantContext(h);
    const repo = new PostgresProfileRepository();
    const [saved, profile] = await Promise.all([repo.getUserLocale(context.userId), repo.getOrgProfile(context.tenantId)]);
    userChoice = saved ?? userChoice;
    organizationDefault = profile?.defaultLocale ?? null;
  } catch {
    // sem sessão ou sem banco: segue com cookie e navegador
  }
  return resolveLocale({ userChoice, organizationDefault, acceptLanguage: h.get("accept-language") });
});
