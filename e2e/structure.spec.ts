import { waitForAuthSlot } from "./helpers/auth-slot";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "pt-BR" });
const SHOTS = process.env.FMCC_SHOTS_DIR;

async function signUpAndCreateOrganization(page: Page) {
  await waitForAuthSlot();
  const suffix = `est-${Date.now()}`;
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
}

test("tela Estrutura: criar matriz, região e filial, renomear, mover e ver a filial em Filiais", async ({ page }) => {
  test.setTimeout(120_000);
  await signUpAndCreateOrganization(page);

  await page.goto("/dashboard/structure");
  await expect(page.getByRole("heading", { name: "Estrutura da empresa", level: 1 })).toBeVisible();
  await expect(page.getByText("A empresa ainda não tem estrutura.")).toBeVisible();
  await page.getByLabel("Nome da matriz").fill("Matriz E2E");
  await page.getByRole("button", { name: "Criar matriz" }).click();
  await expect(page.locator('[data-unit="Matriz E2E"]')).toBeVisible();

  const add = page.getByTestId("add-unit");
  await add.getByLabel("Nome").fill("Região Sul");
  await add.getByLabel("Tipo").selectOption("region");
  await add.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator('[data-unit="Região Sul"]')).toBeVisible();

  await add.getByLabel("Nome").fill("Filial Curitiba");
  await add.getByLabel("Tipo").selectOption("branch");
  await add.getByLabel("Dentro de").selectOption({ label: "Região Sul" });
  await add.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.locator('[data-unit="Filial Curitiba"]')).toBeVisible();

  const branch = page.locator('[data-unit="Filial Curitiba"]');
  await branch.locator("summary").click();
  await branch.getByLabel("Renomear").first().fill("Filial Curitiba Centro");
  await branch.getByRole("button", { name: "Renomear" }).click();
  await expect(page.locator('[data-unit="Filial Curitiba Centro"]')).toBeVisible();

  // Região com filial dentro não sai; a matriz não tem botão de remover.
  const region = page.locator('[data-unit="Região Sul"]');
  await region.locator("summary").click();
  page.once("dialog", (d) => d.accept());
  await region.getByRole("button", { name: "Remover" }).click();
  await expect(page.getByText("A unidade tem filhas ou dados ligados e não pode sair.")).toBeVisible();
  await page.locator('[data-unit="Matriz E2E"] summary').click();
  await expect(page.locator('[data-unit="Matriz E2E"]').getByRole("button", { name: "Remover" })).toHaveCount(0);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/structure.png`, fullPage: true });

  // A filial criada aparece na tela Filiais, sem valor ("Indisponível"), nunca zero.
  await page.goto("/dashboard/units");
  await expect(page.getByRole("cell", { name: "Filial Curitiba Centro" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Filial Curitiba Centro/ })).toContainText("Indisponível");
});
