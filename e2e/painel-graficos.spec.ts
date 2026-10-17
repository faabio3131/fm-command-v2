import { expect, test } from "@playwright/test";
import { seedBranchSeries, shot, signUpAndCreateOrganization } from "./helpers/branch-series";

test.use({ locale: "pt-BR" });

test("painel inicial: tendência mensal, variação, rosca e barras com dado sintético", async ({ page, context }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);
  seedBranchSeries(tenantId, "billing.gross_billed", "billing.invoice");

  await page.goto("/dashboard");
  const trend = page.getByTestId("home-trend");
  await expect(trend).toBeVisible();
  // Último mês fechado = 4 meses atrás... o mais recente fechado soma 52.000 + 36.000 = 88.000 contra 39.000 + 31.000 = 70.000: +25,7%.
  await expect(trend).toContainText("R$ 88.000,00");
  await expect(trend).toContainText("+25,7%");
  // Mês em andamento e meses sem dado nunca viram zero: a tabela de apoio tem 6 linhas e o mês sem Porto Alegre ainda soma só Curitiba.
  await expect(trend.locator("table tbody tr")).toHaveCount(6);
  await expect(trend.locator("svg path.line-chart-path").first()).toBeVisible();
  await expect(trend.locator(".line-chart-open")).toHaveCount(1);

  const share = page.getByTestId("home-share");
  await expect(share).toContainText("Curitiba");
  await expect(share).toContainText("60%");
  await expect(share).toContainText("Manaus");
  await expect(share).toContainText("Indisponível");
  await expect(share.locator("circle.donut-slice")).toHaveCount(2);

  const overflowDesktop = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowDesktop).toBeLessThanOrEqual(1);
  await page.getByTestId("home-branch-ranking").scrollIntoViewIfNeeded();
  await shot(page, "painel-01-pt-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("home-trend")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, "painel-02-pt-mobile");

  const base = new URL(page.url()).origin;
  await context.addCookies([{ name: "fm_locale", value: "en-US", url: base }]);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("home-trend")).toContainText("+25.7%");
  await expect(page.getByTestId("home-share")).toContainText("Unavailable");
  await shot(page, "painel-03-en-desktop");
});
