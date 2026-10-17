import { execFileSync } from "node:child_process";
import { waitForAuthSlot } from "./helpers/auth-slot";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "pt-BR" });
const SHOTS = process.env.FMCC_SHOTS_DIR;
const METRIC = "billing.gross_billed";

function sql(query: string): string {
  return execFileSync("psql", [process.env.DATABASE_URL!, "-At", "-c", query], { encoding: "utf8" }).trim();
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function signUpAndCreateOrganization(page: Page) {
  await waitForAuthSlot();
  const suffix = `gfx-${Date.now()}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Criar uma conta" }).click();
  await page.getByLabel("Nome").fill(`Usuário ${suffix}`);
  await page.getByLabel("E-mail").fill(`${suffix}@example.com`);
  await page.getByPlaceholder("Sua senha").fill("E2e-FMCC-12345!");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForURL(/\/onboarding$/);
  await page.getByLabel("Nome da organização").fill(`Organização ${suffix}`);
  await page.getByLabel("Identificador").fill(`org-${suffix}`);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL(/\/dashboard$/);
  return sql(`select id from auth_organization where slug='org-${suffix}'`);
}

/** Cinco meses de vendas sintéticas: Curitiba cresce, Porto Alegre fica sem dado em um mês, Manaus nunca tem dado. */
function seed(tenantId: string) {
  const unit = (kind: string, parent: string | null, name: string) =>
    sql(`insert into fmcc_org_unit (tenant_id, parent_id, kind, name) values ('${tenantId}', ${parent ? `'${parent}'` : "null"}, '${kind}', '${name}') returning id`).split("\n")[0];
  const hq = unit("company", null, "Matriz Sintética");
  const sul = unit("region", hq, "Sul");
  const cwb = unit("branch", sul, "Curitiba");
  const poa = unit("branch", sul, "Porto Alegre");
  unit("branch", hq, "Manaus");
  const source = "gen_random_uuid()";
  const fact = (unitId: string, monthsBack: number, amount: number, n: number) => sql(`insert into fmcc_canonical_fact (tenant_id, unit_id, source_id, external_id, fact_type, payload, mapping_version, source_timestamp)
    values ('${tenantId}', '${unitId}', ${source}, 'e2e-${unitId}-${monthsBack}-${n}', 'billing.invoice', '{"amount": ${amount}, "currency": "BRL"}', 'v1', date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '${monthsBack} month' + interval '9 days 15 hours')`);
  const cwbByMonth = [30000, 34000, 41000, 39000, 52000, 21000];
  const poaByMonth = [22000, 25000, null, 31000, 36000, 14000];
  cwbByMonth.forEach((v, i) => fact(cwb, 5 - i, v, 1));
  poaByMonth.forEach((v, i) => { if (v !== null) fact(poa, 5 - i, v, 1); });
  const current = (unitId: string, v: string) => sql(`insert into fmcc_metric_value (tenant_id, unit_id, metric_id, metric_version, value, unit, currency, freshness_status, quality_status, source_authority)
    values ('${tenantId}', '${unitId}', '${METRIC}', 1, '${v}', 'currency', 'BRL', 'fresh', 'verified', 'sintetico')`);
  current(cwb, "21000"); current(poa, "14000");
}

test("painel inicial: tendência mensal, variação, rosca e barras com dado sintético", async ({ page, context }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);
  seed(tenantId);

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
