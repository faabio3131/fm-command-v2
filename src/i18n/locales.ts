/**
 * Idiomas da interface (ADR-020). Etiquetas BCP 47.
 * Para incluir um idioma: criar o catálogo em `messages/` com todas as chaves e listá-lo aqui.
 */
export const SUPPORTED_LOCALES = ["pt-BR", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Idioma quando nada indica outro: a FM vende também fora do Brasil, então o padrão global é o inglês. */
export const DEFAULT_LOCALE: Locale = "en-US";

export const LOCALE_COOKIE = "fm_locale";

export function isSupportedLocale(v: unknown): v is Locale {
  return typeof v === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

/**
 * Escolhe o melhor idioma suportado a partir do cabeçalho Accept-Language.
 * "pt" e "pt-PT" caem em pt-BR; "en", "en-GB" etc. caem em en-US.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((e) => e.tag && e.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of ranked) {
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const language = tag.split("-")[0].toLowerCase();
    const byLanguage = SUPPORTED_LOCALES.find((l) => l.split("-")[0].toLowerCase() === language);
    if (byLanguage) return byLanguage;
  }
  return null;
}

/**
 * Ordem de decisão: escolha da pessoa, padrão da empresa, navegador, padrão global.
 * Valores não suportados são ignorados, nunca quebram a tela.
 */
export function resolveLocale(input: {
  userChoice?: string | null;
  organizationDefault?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isSupportedLocale(input.userChoice)) return input.userChoice;
  if (isSupportedLocale(input.organizationDefault)) return input.organizationDefault;
  return negotiateLocale(input.acceptLanguage) ?? DEFAULT_LOCALE;
}
