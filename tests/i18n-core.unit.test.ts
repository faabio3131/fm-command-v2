import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, negotiateLocale, resolveLocale } from "@/i18n/locales";
import { CATALOGS, createTranslator, interpolate, isLocaleCatalogComplete } from "@/i18n/translate";
import { ptBR } from "@/i18n/messages/pt-BR";
import { enUS } from "@/i18n/messages/en-US";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { COMMAND_NAVIGATION } from "@/domain/navigation/command-navigation";

describe("escolha do idioma", () => {
  it("escolha da pessoa vence a da empresa, que vence o navegador", () => {
    expect(resolveLocale({ userChoice: "en-US", organizationDefault: "pt-BR", acceptLanguage: "pt-BR" })).toBe("en-US");
    expect(resolveLocale({ organizationDefault: "pt-BR", acceptLanguage: "en-US" })).toBe("pt-BR");
    expect(resolveLocale({ acceptLanguage: "pt-BR,pt;q=0.9,en;q=0.8" })).toBe("pt-BR");
  });
  it("valores nao suportados sao ignorados e cai no padrao global", () => {
    expect(resolveLocale({ userChoice: "fr-FR", organizationDefault: "xx", acceptLanguage: "fr-FR,de;q=0.8" })).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
  });
  it("negocia por idioma e respeita o peso q", () => {
    expect(negotiateLocale("pt-PT")).toBe("pt-BR");
    expect(negotiateLocale("en-GB,en;q=0.8")).toBe("en-US");
    expect(negotiateLocale("fr;q=0.9,en;q=0.5,pt;q=0.7")).toBe("pt-BR");
    expect(negotiateLocale("pt;q=0,en;q=0.1")).toBe("en-US");
    expect(negotiateLocale("")).toBeNull();
    expect(negotiateLocale("*")).toBeNull();
  });
});

describe("catalogos de traducao", () => {
  it("todo idioma suportado tem todas as chaves, sem texto vazio", () => {
    for (const locale of SUPPORTED_LOCALES) expect(isLocaleCatalogComplete(locale)).toBe(true);
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(ptBR).sort());
  });
  it("os marcadores {nome} sao os mesmos em todos os idiomas", () => {
    const marks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const key of Object.keys(ptBR) as (keyof typeof ptBR)[]) {
      expect(marks(enUS[key]), key).toBe(marks(ptBR[key]));
    }
  });
  it("toda chave .one tem a sua .other e vice-versa", () => {
    const keys = Object.keys(ptBR);
    for (const k of keys.filter((x) => x.endsWith(".one"))) expect(keys).toContain(k.replace(/\.one$/, ".other"));
    for (const k of keys.filter((x) => x.endsWith(".other"))) expect(keys).toContain(k.replace(/\.other$/, ".one"));
  });
  it("o rotulo em portugues da navegacao e o do catalogo (sem divergencia)", () => {
    for (const item of COMMAND_NAVIGATION) expect(ptBR[item.labelKey], item.href).toBe(item.label);
  });
});

describe("tradutor", () => {
  it("traduz, interpola e usa plural do idioma", () => {
    const pt = createTranslator("pt-BR"); const en = createTranslator("en-US");
    expect(pt.t("auth.submit.signIn")).toBe("Entrar");
    expect(en.t("auth.submit.signIn")).toBe("Sign in");
    expect(en.t("shell.env.aria", { env: "Prod" })).toBe("Environment: Prod");
    expect(pt.plural("shell.notifications.badge", 1)).toBe("1 notificação não lida");
    expect(pt.plural("shell.notifications.badge", 3)).toBe("3 notificações não lidas");
    expect(en.plural("shell.notifications.badge", 1)).toBe("1 unread notification");
    expect(en.plural("shell.notifications.badge", 0)).toBe("0 unread notifications");
  });
  it("marcador sem valor fica visivel em vez de sumir", () => {
    expect(interpolate("Ola {nome}", {})).toBe("Ola {nome}");
  });
  it("cai no portugues se um catalogo parcial perder uma chave", () => {
    const partial = { ...CATALOGS["en-US"], "auth.submit.signIn": undefined as unknown as string };
    expect(createTranslator("en-US", partial).t("auth.submit.signIn")).toBe("Entrar");
  });
});

describe("formatacao por Intl", () => {
  it("mesma data, fuso da empresa e idioma da pessoa", () => {
    const iso = "2026-10-15T20:00:00.000Z";
    expect(formatDateTime(iso, "pt-BR", "America/Sao_Paulo")).toContain("15");
    expect(formatDateTime(iso, "en-US", "America/New_York")).toContain("Oct");
    expect(formatNumber(1234567.5, "pt-BR")).toBe("1.234.567,5");
    expect(formatNumber(1234567.5, "en-US")).toBe("1,234,567.5");
  });
});
