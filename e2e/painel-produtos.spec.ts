import { expect, test } from "@playwright/test";
import { shot, signUpAndCreateOrganization, sql } from "./helpers/branch-series";

test.use({ locale: "pt-BR" });

test("painel inicial: produtos mais vendidos com dado sintético, sem zero falso e sem estourar a tela", async ({ page, context }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);
  const unit = (kind: string, parent: string | null, name: string) =>
    sql(`insert into fmcc_org_unit (tenant_id, parent_id, kind, name) values ('${tenantId}', ${parent ? `'${parent}'` : "null"}, '${kind}', '${name}') returning id`).split("\n")[0];
  const hq = unit("company", null, "Matriz Sintética");
  const cwb = unit("branch", hq, "Curitiba");
  const mao = unit("branch", hq, "Manaus");
  const line = (unitId: string, n: number, productRef: string | null, description: string, cents: number) => sql(`insert into fmcc_canonical_fact (tenant_id, unit_id, source_id, external_id, fact_type, payload, mapping_version, source_timestamp)
    values ('${tenantId}', '${unitId}', gen_random_uuid(), 'e2e-item-${n}', 'sales.order_item', '${JSON.stringify({ status: "invoiced", currency: "BRL", amountMinor: cents, ...(productRef ? { productRef, description } : {}) })}', 'v1', now())`);
  line(cwb, 1, "301", "Camiseta básica", 60000);
  line(cwb, 2, "302", "Calça jeans", 40000);
  line(mao, 3, "301", "Camiseta básica", 50000);
  line(mao, 4, "303", "Boné", 10000);
  line(mao, 5, null, "", 5000); // linha sem código de produto: fora do ranking, só avisada

  await page.goto("/dashboard");
  const section = page.getByTestId("home-product-ranking");
  await expect(section).toBeVisible();
  await expect(section).toContainText("Produtos mais vendidos");
  const rows = section.locator(".bar-chart-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Camiseta básica");
  await expect(rows.nth(0)).toContainText("R$ 1.100,00"); // 600 + 500
  await expect(rows.nth(1)).toContainText("Calça jeans");
  await expect(rows.nth(2)).toContainText("Boné");
  await expect(rows.nth(2)).toContainText("R$ 100,00");
  await expect(section).toContainText("Produtos com valor: 3");
  await expect(section).toContainText("sem código de produto, fora do ranking: 1");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await section.scrollIntoViewIfNeeded();
  await shot(page, "produtos-01-pt-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("home-product-ranking")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await shot(page, "produtos-02-pt-mobile");

  const base = new URL(page.url()).origin;
  await context.addCookies([{ name: "fm_locale", value: "en-US", url: base }]);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("home-product-ranking")).toContainText("Top-selling products");
  await expect(page.getByTestId("home-product-ranking")).toContainText("1,100.00");
  await shot(page, "produtos-03-en-desktop");
});
