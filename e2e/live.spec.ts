import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { LIVE_TARGET_MS } from "../src/domain/live/pulse";
import { waitForAuthSlot } from "./helpers/auth-slot";

test.use({ locale: "pt-BR" });
const SHOTS = process.env.FMCC_SHOTS_DIR;
const METRIC = "revenue.cash_collected";

function sql(query: string): string {
  return execFileSync("psql", [process.env.DATABASE_URL!, "-At", "-c", query], { encoding: "utf8" }).trim();
}
async function signUpAndCreateOrganization(page: Page) {
  await waitForAuthSlot();
  const suffix = `live-${Date.now()}`;
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
const unit = (tenantId: string, kind: string, parent: string | null, name: string) =>
  sql(`insert into fmcc_org_unit (tenant_id, parent_id, kind, name) values ('${tenantId}', ${parent ? `'${parent}'` : "null"}, '${kind}', '${name}') returning id`).split("\n")[0];
const value = (tenantId: string, unitId: string, v: string) => sql(`insert into fmcc_metric_value (tenant_id, unit_id, metric_id, metric_version, value, unit, currency, freshness_status, quality_status, source_authority)
  values ('${tenantId}', '${unitId}', '${METRIC}', 1, '${v}', 'currency', 'BRL', 'fresh', 'verified', 'sintetico')`);

test("número e alerta aparecem sozinhos, sem recarregar, dentro da meta", async ({ page }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);
  const hq = unit(tenantId, "company", null, "Matriz");
  const sul = unit(tenantId, "region", hq, "Sul");
  const cwb = unit(tenantId, "branch", sul, "Curitiba");
  const poa = unit(tenantId, "branch", sul, "Porto Alegre");
  value(tenantId, cwb, "100");

  await page.goto(`/dashboard/units?metric=${METRIC}`);
  await expect(page.getByText("R$ 100,00").first()).toBeVisible();
  await expect(page.locator(".live-status")).toContainText("Ao vivo");
  // Marca na página: se a página recarregar de verdade, ela some.
  await page.evaluate(() => { (window as unknown as { __semRecarga: boolean }).__semRecarga = true; });

  // 1) Número: grava um valor novo e mede até a tela mostrar o novo total.
  const wroteNumber = Date.now();
  value(tenantId, poa, "250.50");
  await expect(page.getByText("R$ 350,50").first()).toBeVisible({ timeout: LIVE_TARGET_MS + 5_000 });
  const numberMs = Date.now() - wroteNumber;
  expect(await page.evaluate(() => (window as unknown as { __semRecarga?: boolean }).__semRecarga)).toBe(true);
  expect(numberMs).toBeLessThanOrEqual(LIVE_TARGET_MS);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-01-numero.png`, fullPage: true });

  // 2) Alerta: grava um evento de alerta e mede até aparecer em Atividades, sem recarregar.
  await page.goto("/dashboard/activity");
  await expect(page.locator(".live-status")).toContainText("Ao vivo");
  await page.evaluate(() => { (window as unknown as { __semRecarga: boolean }).__semRecarga = true; });
  await expect(page.getByText("Alerta gerado")).toHaveCount(0);
  const wroteAlert = Date.now();
  sql(`insert into fmcc_audit_event (tenant_id, actor_id, actor_type, action, resource_type, resource_id, result, correlation_id)
       values ('${tenantId}', 'sistema', 'system', 'alert.raised', 'alert_occurrence', 'occ-live', 'attention', 'corr-live-${Date.now()}')`);
  await expect(page.getByText("Alerta gerado").first()).toBeVisible({ timeout: LIVE_TARGET_MS + 5_000 });
  const alertMs = Date.now() - wroteAlert;
  expect(await page.evaluate(() => (window as unknown as { __semRecarga?: boolean }).__semRecarga)).toBe(true);
  expect(alertMs).toBeLessThanOrEqual(LIVE_TARGET_MS);
  console.log(`LIVE_MEDIDO numero_ms=${numberMs} alerta_ms=${alertMs} meta_ms=${LIVE_TARGET_MS}`);
});

test("aba escondida não consulta; ao voltar, confere na hora", async ({ page }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);
  const hq = unit(tenantId, "company", null, "Matriz");
  const sul = unit(tenantId, "region", hq, "Sul");
  const cwb = unit(tenantId, "branch", sul, "Curitiba");
  value(tenantId, cwb, "10");
  await page.goto(`/dashboard/units?metric=${METRIC}`);
  await expect(page.getByText("R$ 10,00").first()).toBeVisible();

  let pulses = 0;
  page.on("request", (request) => { if (request.url().includes("/api/live/pulse")) pulses += 1; });
  // Simula aba escondida.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(LIVE_TARGET_MS + 2_000);
  expect(pulses).toBeLessThanOrEqual(1); // no máximo a consulta que já estava em andamento
  await expect(page.locator(".live-status")).toContainText("Pausado");

  value(tenantId, cwb, "5");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("R$ 5,00").first()).toBeVisible({ timeout: 6_000 }); // o valor mais novo da filial substitui o anterior (não soma)
});
