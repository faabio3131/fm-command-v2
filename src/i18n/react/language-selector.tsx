"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocaleAction } from "@/app/actions/locale";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { useTranslator } from "./i18n-provider";

export function LanguageSelector() {
  const { locale, t } = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="locale-select">
      <span className="sr-only">{t("locale.selector.label")}</span>
      <select
        value={locale}
        disabled={pending}
        aria-label={t("locale.selector.label")}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(async () => {
            await setLocaleAction(next);
            router.refresh();
          });
        }}
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>{t(`locale.name.${l}`)}</option>
        ))}
      </select>
    </label>
  );
}
