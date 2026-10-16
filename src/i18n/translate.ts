import { SUPPORTED_LOCALES, type Locale } from "./locales";
import { enUS } from "./messages/en-US";
import { ptBR, type MessageKey } from "./messages/pt-BR";

export type { MessageKey } from "./messages/pt-BR";
export type Messages = Readonly<Record<MessageKey, string>>;

export const CATALOGS: Readonly<Record<Locale, Messages>> = { "pt-BR": ptBR, "en-US": enUS };

/** Chaves que têm variantes `.one` e `.other`, para plural (regras do idioma via Intl.PluralRules). */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never;

export type Params = Readonly<Record<string, string | number>>;

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export type Translate = (key: MessageKey, params?: Params) => string;

export interface Translator {
  readonly locale: Locale;
  t(key: MessageKey, params?: Params): string;
  plural(key: PluralKey, count: number, params?: Params): string;
}

export function createTranslator(locale: Locale, catalog: Messages = CATALOGS[locale]): Translator {
  const rules = new Intl.PluralRules(locale);
  const t = (key: MessageKey, params?: Params) => interpolate(catalog[key] ?? ptBR[key] ?? key, params);
  return {
    locale,
    t,
    plural(key, count, params) {
      const category = rules.select(count);
      const variant = (category === "one" ? `${key}.one` : `${key}.other`) as MessageKey;
      return t(variant, { count, ...params });
    },
  };
}

export function isLocaleCatalogComplete(locale: Locale): boolean {
  const keys = Object.keys(ptBR) as MessageKey[];
  return keys.every((k) => typeof CATALOGS[locale][k] === "string" && CATALOGS[locale][k].length > 0);
}

export const ALL_LOCALES = SUPPORTED_LOCALES;
