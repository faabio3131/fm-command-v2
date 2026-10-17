import { expect, test } from "@playwright/test";
import { seedBranchSeries, shot, signUpAndCreateOrganization } from "./helpers/branch-series";

test.use({ locale: "pt-BR" });

test("tela Finanças: gráficos por filial, troca de métrica e período, inglês e celular", async ({ page, context }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);
  seedBranchSeries(tenantId, "billing.gross_billed", "billing.invoice");

  await page.goto("/dashboard/finance");
  await expect(page.getByRole("heading", { name: "Inteligência financeira governada" }).first()).toBeVisible();
  const trend = page.getByTestId("home-trend");
  await expect(trend).toContainText("R$ 88.000,00");
  await expect(trend).toContainText("+25,7%");
  await expect(page.getByTestId("home-share")).toContainText("Manaus");
  await expect(page.getByTestId("home-share")).toContainText("Indisponível");
  await shot(page, "financas-01-pt");

  // Outra métrica financeira sem nenhum dado: tudo indisponível, nunca zero, e a tela não quebra.
  await page.getByLabel("Métrica").selectOption("revenue.cash_collected");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.waitForURL(/metric=revenue\.cash_collected/);
  await expect(page.getByTestId("home-trend")).toContainText("Variação indisponível");
  await expect(page.getByTestId("home-trend")).not.toContainText("R$ 0,00");

  // Período: o mês anterior nas barras e na rosca do cartão de filiais.
  await page.getByLabel("Métrica").selectOption("billing.gross_billed");
  await page.getByLabel("Período").selectOption("previous");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.waitForURL(/period=previous/);
  await expect(page.getByTestId("home-trend")).toContainText("R$ 88.000,00");

  const base = new URL(page.url()).origin;
  await context.addCookies([{ name: "fm_locale", value: "en-US", url: base }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/finance");
  await expect(page.getByTestId("home-trend")).toContainText("+25.7%");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, "financas-02-en-mobile");
});
