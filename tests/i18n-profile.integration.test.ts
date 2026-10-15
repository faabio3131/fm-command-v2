import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { orgProfiles, userPreferences } from "@/infrastructure/db/profile-schema";
import { PostgresProfileRepository, ProfileValidationError } from "@/infrastructure/i18n/postgres-profile-repository";
import { validateOrgProfile } from "@/domain/organization/org-profile";

const A = "perfil-empresa-a";
const B = "perfil-empresa-b";
const U = "perfil-usuario-1";
const repo = new PostgresProfileRepository();
const valid = { defaultLocale: "en-US", countryCode: "US", currency: "USD", timezone: "America/New_York", dataRegion: "us" };

async function cleanup() {
  await db.delete(orgProfiles).where(inArray(orgProfiles.tenantId, [A, B]));
  await db.delete(userPreferences).where(inArray(userPreferences.userId, [U]));
}
beforeAll(cleanup);
afterAll(cleanup);

describe("perfil regional da empresa (ADR-020)", () => {
  it("valida idioma, pais, moeda, fuso e regiao", () => {
    expect(validateOrgProfile({ tenantId: A, ...valid }).ok).toBe(true);
    const bad = validateOrgProfile({ tenantId: A, defaultLocale: "fr-FR", countryCode: "us", currency: "ZZZ", timezone: "Marte/Olimpo", dataRegion: "lua" });
    expect(!bad.ok && bad.errors).toEqual(expect.arrayContaining([
      "profile.locale_not_supported", "profile.country_must_be_iso_3166_alpha2", "profile.currency_must_be_iso_4217",
      "profile.timezone_must_be_iana", "profile.data_region_unknown"]));
  });
  it("salva, le e atualiza o perfil de uma empresa sem afetar outra", async () => {
    expect(await repo.getOrgProfile(A)).toBeNull();
    await repo.saveOrgProfile({ tenantId: A, ...valid, updatedBy: "dono-a" });
    await repo.saveOrgProfile({ tenantId: B, defaultLocale: "pt-BR", countryCode: "BR", currency: "BRL", timezone: "America/Sao_Paulo", updatedBy: "dono-b" });
    expect((await repo.getOrgProfile(A))?.currency).toBe("USD");
    expect((await repo.getOrgProfile(B))?.defaultLocale).toBe("pt-BR");
    await repo.saveOrgProfile({ tenantId: A, ...valid, timezone: "America/Chicago", updatedBy: "dono-a" });
    expect((await repo.getOrgProfile(A))?.timezone).toBe("America/Chicago");
    expect((await repo.getOrgProfile(B))?.timezone).toBe("America/Sao_Paulo");
  });
  it("recusa perfil invalido sem gravar nada", async () => {
    await expect(repo.saveOrgProfile({ tenantId: B, ...valid, currency: "dolar", updatedBy: "x" })).rejects.toBeInstanceOf(ProfileValidationError);
    expect((await repo.getOrgProfile(B))?.currency).toBe("BRL");
  });
  it("o banco recusa pais e moeda fora do padrao mesmo sem passar pelo codigo", async () => {
    await expect(db.insert(orgProfiles).values({ tenantId: "perfil-x", defaultLocale: "pt-BR", countryCode: "br", currency: "BRL", timezone: "America/Sao_Paulo", updatedBy: "x" })).rejects.toThrow();
    await expect(db.insert(orgProfiles).values({ tenantId: "perfil-x", defaultLocale: "pt-BR", countryCode: "BR", currency: "BRL", timezone: "America/Sao_Paulo", dataRegion: "lua", updatedBy: "x" })).rejects.toThrow();
  });
});

describe("idioma escolhido pela pessoa", () => {
  it("guarda, troca e recusa idioma nao suportado", async () => {
    expect(await repo.getUserLocale(U)).toBeNull();
    await repo.setUserLocale(U, "en-US");
    expect(await repo.getUserLocale(U)).toBe("en-US");
    await repo.setUserLocale(U, "pt-BR");
    expect(await repo.getUserLocale(U)).toBe("pt-BR");
    await expect(repo.setUserLocale(U, "klingon")).rejects.toBeInstanceOf(ProfileValidationError);
    expect(await repo.getUserLocale(U)).toBe("pt-BR");
  });
});
