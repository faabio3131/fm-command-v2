import { waitForAuthSlot } from "./helpers/auth-slot";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "pt-BR" });
const SHOTS = process.env.FMCC_SHOTS_DIR;

function sql(query: string): string {
  return execFileSync("psql", [process.env.DATABASE_URL!, "-At", "-c", query], { encoding: "utf8" }).trim();
}
async function signUpAndCreateOrganization(page: Page) {
  await waitForAuthSlot();
  const suffix = `set-${Date.now()}`;
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

test("tela de Setores: ligar pacote, ver painel, criar relatório sugerido e filtrar seletores", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndCreateOrganization(page);

  await page.goto("/dashboard/sectors");
  await expect(page.getByRole("heading", { name: "Setores", level: 1 })).toBeVisible();
  const transport = page.locator('[data-pack="transport"]');
  await expect(transport).toContainText("Desligado");
  await expect(transport.getByText("transport.delivery")).toBeVisible();

  // Desligado: o painel avisa e as métricas do pacote não aparecem nos seletores.
  await page.goto("/dashboard/sectors/transport");
  await expect(page.getByText("Este pacote não está ligado nesta empresa.")).toBeVisible();
  await page.goto("/dashboard/reports");
  await expect(page.getByLabel("Frete faturado").first()).toHaveCount(0);

  await page.goto("/dashboard/sectors");
  await transport.getByRole("button", { name: "Ligar pacote" }).click();
  await expect(transport).toContainText("Ligado");
  await transport.getByRole("button", { name: "Criar relatório sugerido" }).click();
  await expect(transport.getByText("Relatório criado em Relatórios.")).toBeVisible();
  await transport.getByRole("button", { name: "Criar relatório sugerido" }).click();
  await expect(transport.getByText("O relatório sugerido já existe.")).toBeVisible();

  await transport.getByRole("link", { name: "Abrir painel" }).click();
  await expect(page.getByRole("heading", { name: "Transporte e logística", level: 1 })).toBeVisible();
  const card = page.locator('[data-metric="transport.freight.revenue"]');
  await expect(card).toContainText("Indisponível");
  await expect(card.getByRole("link", { name: "Ver por filial" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sectors-dashboard.png`, fullPage: true });

  await page.goto("/dashboard/reports");
  await expect(page.locator("[data-report]")).toHaveCount(1);
  await expect(page.getByLabel("Frete faturado").first()).toBeVisible();
  await page.goto("/dashboard/units");
  await expect(page.locator('select[name="metric"] option', { hasText: "Frete faturado" })).toHaveCount(1);
  await expect(page.locator('select[name="metric"] option', { hasText: "Custo de refugo" })).toHaveCount(0);

  // Segundo pacote continua desligado; desligar tira o painel.
  await page.goto("/dashboard/sectors");
  await transport.getByRole("button", { name: "Desligar pacote" }).click();
  await expect(transport).toContainText("Desligado");
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });
  test("Sectors screen in English", async ({ page }) => {
    test.setTimeout(120_000);
    await waitForAuthSlot();
    const suffix = `set-en-${Date.now()}`;
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Name").fill(`User ${suffix}`);
    await page.getByLabel("Email").fill(`${suffix}@example.com`);
    await page.getByPlaceholder("Your password").fill("E2e-FMCC-12345!");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/onboarding$/);
    await page.getByLabel("Organization name").fill(`Org ${suffix}`);
    await page.getByLabel("Identifier").fill(`org-${suffix}`);
    await page.getByRole("button", { name: "Create organization" }).click();
    await page.waitForURL(/\/dashboard$/);
    await page.goto("/dashboard/sectors");
    await expect(page.getByRole("heading", { name: "Sectors", level: 1 })).toBeVisible();
    const industry = page.locator('[data-pack="industry"]');
    await expect(industry).toContainText("Off");
    await industry.getByRole("button", { name: "Turn on pack" }).click();
    await expect(industry).toContainText("On");
    await industry.getByRole("link", { name: "Open dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Industry", level: 1 })).toBeVisible();
    await expect(page.getByText("Unavailable").first()).toBeVisible();
  });
});
