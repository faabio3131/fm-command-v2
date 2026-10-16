import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getCompanyTimeZone, FALLBACK_TIME_ZONE } from "@/application/i18n/request-timezone";
import { db } from "@/infrastructure/db/client";
import { orgProfiles } from "@/infrastructure/db/profile-schema";
import { PostgresProfileRepository } from "@/infrastructure/i18n/postgres-profile-repository";
import { formatDateTime } from "@/i18n/format";

const SP = "fuso-empresa-sp";
const AKL = "fuso-empresa-akl";
const NONE = "fuso-empresa-sem-perfil";
const repo = new PostgresProfileRepository();

async function cleanup() {
  await db.delete(orgProfiles).where(inArray(orgProfiles.tenantId, [SP, AKL]));
}
beforeAll(async () => {
  await cleanup();
  await repo.saveOrgProfile({ tenantId: SP, defaultLocale: "pt-BR", countryCode: "BR", currency: "BRL", timezone: "America/Sao_Paulo", updatedBy: "t" });
  await repo.saveOrgProfile({ tenantId: AKL, defaultLocale: "en-US", countryCode: "NZ", currency: "NZD", timezone: "Pacific/Auckland", updatedBy: "t" });
});
afterAll(cleanup);

describe("data e fuso pela empresa (etapa 9T)", () => {
  it("cada empresa vê a mesma hora no seu próprio fuso, sem São Paulo fixo no código", async () => {
    const instant = "2026-10-16T02:30:00Z";
    const sp = formatDateTime(instant, "pt-BR", await getCompanyTimeZone(SP));
    const akl = formatDateTime(instant, "en-US", await getCompanyTimeZone(AKL));
    expect(await getCompanyTimeZone(SP)).toBe("America/Sao_Paulo");
    expect(await getCompanyTimeZone(AKL)).toBe("Pacific/Auckland");
    expect(sp).toContain("15 de out. de 2026"); // 23:30 do dia anterior em São Paulo
    expect(sp).toContain("23:30");
    expect(akl).toContain("Oct 16, 2026"); // 15:30 do mesmo dia na Nova Zelândia
    expect(akl).toMatch(/3:30\s?PM/);
    expect(sp).not.toBe(akl);
  });

  it("empresa sem perfil usa UTC, nunca um fuso inventado", async () => {
    expect(await getCompanyTimeZone(NONE)).toBe(FALLBACK_TIME_ZONE);
    expect(FALLBACK_TIME_ZONE).toBe("UTC");
  });
});
