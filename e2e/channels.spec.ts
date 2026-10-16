import { execFileSync } from "node:child_process";
import { waitForAuthSlot } from "./helpers/auth-slot";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "pt-BR" });
const SHOTS = process.env.FMCC_SHOTS_DIR;

function sql(query: string): string {
  return execFileSync("psql", [process.env.DATABASE_URL!, "-At", "-c", query], { encoding: "utf8" }).trim();
}
async function signUpAndCreateOrganization(page: Page) {
  await waitForAuthSlot();
  const suffix = `chn-${Date.now()}`;
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

test("tela de Canais: configurar e-mail simulado, cadastrar destinatário, enviar teste e ver o recibo", async ({ page }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);
  await page.goto("/dashboard/channels");
  await expect(page.getByRole("heading", { name: "Canais", level: 1 })).toBeVisible();

  const email = page.locator('[data-channel="email"]');
  await expect(email.getByText("Provedor de teste")).toBeVisible();
  await email.getByLabel("Remetente").fill("alertas@fm.test");
  await email.getByLabel("Canal ligado").check();
  await email.getByRole("button", { name: "Salvar canal" }).click();
  await expect(email.getByText("Canal salvo.")).toBeVisible();

  await email.getByLabel("Endereço").fill("endereco-invalido");
  await email.getByRole("button", { name: "Adicionar" }).click();
  await expect(email.getByText("Endereço inválido para este canal.")).toBeVisible();

  await email.getByLabel("Endereço").fill("Ana@Empresa.com");
  await email.getByRole("button", { name: "Adicionar" }).click();
  await expect(email.getByText("ana@empresa.com")).toBeVisible();

  await email.getByRole("button", { name: "Enviar teste" }).click();
  await expect(email.getByText("Teste: Enviado")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Enviado", exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/channels.png`, fullPage: true });

  // A configuração não guarda chave nenhuma (provedor simulado sem credencial) e o recibo ficou no banco da empresa.
  expect(sql(`select count(*) from fmcc_channel_delivery where tenant_id='${tenantId}' and status='sent'`)).toBe("1");
  expect(sql(`select count(*) from fmcc_channel_config where tenant_id='${tenantId}' and secret_ref is not null`)).toBe("0");

  // Desligar o destinatário e remover.
  await email.getByRole("button", { name: "Desligar" }).click();
  await expect(email.getByRole("button", { name: "Ligar" })).toBeVisible();
  await email.getByRole("button", { name: "Remover" }).click();
  await expect(email.getByText("Nenhum destinatário cadastrado.")).toBeVisible();
});

test("tela de Canais em inglês", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.addCookies([{ name: "fm_locale", value: "en-US", url: "http://127.0.0.1:" + (process.env.FMCC_E2E_PORT ?? "3000") }]);
  await signUpAndCreateOrganizationEn(page);
  await page.goto("/dashboard/channels");
  await expect(page.getByRole("heading", { name: "Channels", level: 1 })).toBeVisible();
  await expect(page.getByText("No recipients yet.").first()).toBeVisible();
  await expect(page.getByText("Nothing sent yet.")).toBeVisible();
});

async function signUpAndCreateOrganizationEn(page: Page) {
  await waitForAuthSlot();
  const suffix = `chn-en-${Date.now()}`;
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
}
