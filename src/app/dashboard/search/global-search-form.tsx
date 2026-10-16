"use client";

import { useEffect, useRef } from "react";

export function GlobalSearchForm({ query }: { query: string }) {
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
        Buscar <kbd>Ctrl/Cmd + K</kbd>
      </label>
      <input
        ref={inputRef}
        id="global-search-query"
        name="q"
        type="search"
        minLength={2}
        maxLength={80}
        defaultValue={query}
        placeholder="Ex.: Kordena, MRR, integrações, incidentes"
        autoComplete="off"
      />
      <button className="button primary" type="submit">
        Buscar
      </button>
    </form>
  );
}
