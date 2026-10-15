"use server";

import { cookies, headers } from "next/headers";
import { auth } from "@/infrastructure/auth/auth";
import { PostgresProfileRepository } from "@/infrastructure/i18n/postgres-profile-repository";
import { LOCALE_COOKIE, isSupportedLocale } from "@/i18n/locales";

/** Troca o idioma da pessoa: cookie para qualquer visitante e, se houver sessão, também no perfil dela. */
export async function setLocaleAction(locale: string): Promise<{ ok: boolean }> {
  if (!isSupportedLocale(locale)) return { ok: false };
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production",
  });
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session) await new PostgresProfileRepository().setUserLocale(session.user.id, locale);
  } catch {
    // o cookie já vale; salvar no perfil é complemento
  }
  return { ok: true };
}
