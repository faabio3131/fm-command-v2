import { expect, test } from "@playwright/test";
import { seedBranchSeries, shot, signUpAndCreateOrganization } from "./branch-series";

export interface Tela { rota: string; metrica: string; fato: string; titulo: string; foto: string; tom: "good" | "bad" }

/** Teste comum das telas de métricas por área: cartão soma as filiais, gráficos por filial, cor da variação pelo sentido da métrica, inglês e celular. */
export function testeTela(tela: Tela) {
  test(`${tela.foto}: cartão soma as filiais, gráficos por filial, inglês e celular`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const tenantId = await signUpAndCreateOrganization(page);
    seedBranchSeries(tenantId, tela.metrica, tela.fato, "count");

    await page.goto(tela.rota);
    // Mês atual: Curitiba 2 + Porto Alegre 1 = 3 (Manaus sem dado fora da soma, nunca zero).
    const card = page.locator('[data-consolidated="true"]').filter({ hasText: tela.titulo });
    await expect(card).toContainText("3");
    await expect(card).toContainText("Consolidado: 2 de 3 filiais com dado");
    await expect(card).toContainText("Total parcial");
    // Último mês fechado: 5 + 4 = 9 contra 4 + 3 = 7 no anterior (+28,6%).
    const trend = page.getByTestId("home-trend");
    await expect(trend).toContainText("9");
    await expect(trend).toContainText("+28,6%");
    // Cor pelo sentido da métrica: incidente que sobe é ruim (vermelho); lead, teste e uso que sobem são bons.
    await expect(trend.locator(".delta")).toHaveAttribute("data-tone", tela.tom);
    await expect(page.getByTestId("home-share")).toContainText("Manaus");
    await expect(page.getByTestId("home-share")).toContainText("Indisponível");
    await shot(page, `${tela.foto}-01-pt`);

    const base = new URL(page.url()).origin;
    await context.addCookies([{ name: "fm_locale", value: "en-US", url: base }]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(tela.rota);
    await expect(page.getByTestId("home-trend")).toContainText("+28.6%");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, `${tela.foto}-02-en-mobile`);
  });
}
