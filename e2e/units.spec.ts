import { execFileSync } from "node:child_process";
import { waitForAuthSlot } from "./helpers/auth-slot";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "pt-BR" });
const SHOTS = process.env.FMCC_SHOTS_DIR;
const METRIC = "revenue.cash_collected";

function sql(query: string): string {
  return execFileSync("psql", [process.env.DATABASE_URL!, "-At", "-c", query], { encoding: "utf8" }).trim();
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function signUpAndCreateOrganization(page: Page) {
  await waitForAuthSlot();
  const suffix = `uni-${Date.now()}`;
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
function seed(tenantId: string) {
  const unit = (kind: string, parent: string | null, name: string) =>
    sql(`insert into fmcc_org_unit (tenant_id, parent_id, kind, name) values ('${tenantId}', ${parent ? `'${parent}'` : "null"}, '${kind}', '${name}') returning id`).split("\n")[0];
  const hq = unit("company", null, "Matriz Sintética");
  const sul = unit("region", hq, "Sul");
  const norte = unit("region", hq, "Norte");
  const cwb = unit("branch", sul, "Curitiba");
  const poa = unit("branch", sul, "Porto Alegre");
  const man = unit("branch", norte, "Manaus");
  const value = (unitId: string, v: string) => sql(`insert into fmcc_metric_value (tenant_id, unit_id, metric_id, metric_version, value, unit, currency, freshness_status, quality_status, source_authority)
    values ('${tenantId}', '${unitId}', '${METRIC}', 1, '${v}', 'currency', 'BRL', 'fresh', 'verified', 'sintetico')`);
  value(cwb, "1000.50"); value(poa, "3000.25");
  // Manaus não tem valor: tem de aparecer como indisponível, nunca zero.
  return { man, sul };
}

test("tela de Filiais: total, ranking, indisponível, filtro por região, inglês e celular", async ({ page, context }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);
  const { sul } = seed(tenantId);

  await page.goto(`/dashboard/units?metric=${METRIC}`);
  await expect(page.getByRole("heading", { name: "Filiais" })).toBeVisible();
  // Total só das 2 filiais com dado: 1000,50 + 3000,25 = 4.000,75 (e Manaus fora, não contada como zero).
  await expect(page.getByText("R$ 4.000,75").first()).toBeVisible();
  await expect(page.getByText("2 de 3 filiais com dado")).toBeVisible();
  await expect(page.getByText("Total parcial")).toBeVisible();
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Porto Alegre");
  await expect(rows.nth(0)).toContainText("1");
  await expect(rows.nth(1)).toContainText("Curitiba");
  await expect(rows.nth(2)).toContainText("Manaus");
  await expect(rows.nth(2)).toContainText("Indisponível");
  await expect(rows.nth(2)).not.toContainText("R$");
  await shot(page, "units-01-pt");

  // Filtro por região (envio do formulário, como a pessoa faz).
  await page.getByLabel("Região").selectOption(sul);
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.waitForURL(/region=/);
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  await expect(page.getByText("2 de 2 filiais com dado")).toBeVisible();
  await expect(page.getByText("Total parcial")).toHaveCount(0);
  await shot(page, "units-02-regiao");

  // Período: o mês anterior não tem dado nesta empresa de teste, então tudo fica "Indisponível" (nunca zero); voltar ao mês atual traz os valores.
  await page.getByLabel("Período").selectOption("previous");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.waitForURL(/period=previous/);
  await expect(page.locator("table tbody tr").first()).toContainText("Indisponível");
  await expect(page.getByText("R$ 4.000,75")).toHaveCount(0);
  await page.getByLabel("Período").selectOption("current");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.waitForURL(/period=current/);
  await expect(page.getByText("R$ 4.000,75").first()).toBeVisible();

  // Região inventada: não derruba a tela, não revela nada, volta ao recorte geral.
  await page.goto(`/dashboard/units?metric=${METRIC}&region=00000000-0000-0000-0000-000000000000`);
  await expect(page.getByText("Esta região não está disponível para você.")).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(3);

  // Inglês e celular.
  const base = new URL(page.url()).origin;
  await context.addCookies([{ name: "fm_locale", value: "en-US", url: base }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/units?metric=${METRIC}`);
  await expect(page.getByRole("heading", { name: "Branches" })).toBeVisible();
  await expect(page.getByText("R$4,000.75").first()).toBeVisible();
  await expect(page.getByText("2 of 3 branches with data")).toBeVisible();
  await expect(page.locator("table tbody tr").nth(2)).toContainText("Unavailable");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, "units-03-en-mobile");
});
