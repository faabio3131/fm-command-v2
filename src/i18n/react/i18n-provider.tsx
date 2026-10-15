"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@/i18n/locales";
import { createTranslator, type Messages, type Translator } from "@/i18n/translate";

const Ctx = createContext<Translator | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const translator = useMemo(() => createTranslator(locale, messages), [locale, messages]);
  return <Ctx.Provider value={translator}>{children}</Ctx.Provider>;
}

export function useTranslator(): Translator {
  const value = useContext(Ctx);
  if (!value) throw new Error("i18n.provider_missing");
  return value;
}
