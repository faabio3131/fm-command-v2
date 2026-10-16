"use client";

import { useEffect, useRef } from "react";
import { useTranslator } from "@/i18n/react/i18n-provider";

export function GlobalSearchForm({ query }: { query: string }) {
  const { t } = useTranslator();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form action="/dashboard/search" method="get" role="search">
      <label htmlFor="global-search-query">
        {t("search.form.label")} <kbd>Ctrl/Cmd + K</kbd>
      </label>
      <input
        ref={inputRef}
        id="global-search-query"
        name="q"
        type="search"
        minLength={2}
        maxLength={80}
        defaultValue={query}
        placeholder={t("search.form.placeholder")}
        autoComplete="off"
      />
      <button className="button primary" type="submit">
        {t("search.form.submit")}
      </button>
    </form>
  );
}
