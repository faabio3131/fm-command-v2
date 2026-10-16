import { execFileSync } from "node:child_process";
import { waitForAuthSlot } from "./helpers/auth-slot";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "pt-BR" });
const SHOTS = process.env.FMCC_SHOTS_DIR;
const SECRET_APP_KEY = "synthetic-app-key-0001";
const SECRET_APP_SECRET = "synthetic-app-secret-ZZ9";

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

function sql(query: string): string {
  return execFileSync("psql", [process.env.DATABASE_URL!, "-At", "-c", query], { encoding: "utf8" }).trim();
}

async function signUpAndCreateOrganization(page: Page) {
  await waitForAuthSlot();
  const suffix = `src-${Date.now()}`;
  const password = "E2e-FMCC-12345!";
  const slug = `org-${suffix}`;
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Criar uma conta" }).click();
  await page.getByLabel("Nome").fill(`Usuário ${suffix}`);
  await page.getByLabel("E-mail").fill(`${suffix}@example.com`);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForURL(/\/onboarding$/);
  await page.getByLabel("Nome da organização").fill(`Organização ${suffix}`);
  await page.getByLabel("Identificador").fill(slug);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL(/\/dashboard$/);
  return { slug };
}

test("tela de Fontes: catálogo, conexão, acesso sem vazar segredo, mapa de filiais, teste e OAuth sem configuração", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const { slug } = await signUpAndCreateOrganization(page);
  const tenantId = sql(`select id from auth_organization where slug='${slug}'`);
  sql(`insert into fmcc_org_unit (tenant_id, kind, name) values ('${tenantId}','company','Matriz Sintética')`);
  const companyId = sql(`select id from fmcc_org_unit where tenant_id='${tenantId}' and kind='company'`);
  sql(`insert into fmcc_org_unit (tenant_id, parent_id, kind, name) values ('${tenantId}','${companyId}','branch','Filial Centro')`);

  await page.goto("/dashboard/sources");
  await expect(page.getByRole("heading", { name: "Fontes e Integrações" })).toBeVisible();
  const catalog = page.locator('[aria-labelledby="catalog-title"]');
  for (const name of ["Omie", "Conta Azul", "Bling"]) {
    await expect(catalog.locator("article", { hasText: name }).getByRole("button", { name: "Conectar" })).toBeVisible();
  }
  for (const name of ["Xero", "QuickBooks"]) {
    const card = catalog.locator("article", { hasText: name });
    await expect(card).toContainText("Em preparação");
    await expect(card.getByRole("button", { name: "Conectar" })).toHaveCount(0);
  }
  await expect(page.getByText("Nenhuma conexão configurada.")).toBeVisible();
  await shot(page, "01-catalogo-pt");

  // criar conexão Omie
  await catalog.locator("article", { hasText: "Omie" }).getByRole("button", { name: "Conectar" }).click();
  await expect(page.getByText("Conectar Omie")).toBeVisible();
  await page.getByLabel("Nome desta conexão").fill("Omie Matriz");
  await page.getByRole("button", { name: "Criar conexão" }).click();
  await expect(page.getByText("Conexão criada.")).toBeVisible();
  const list = page.locator('[aria-labelledby="source-list-title"]');
  const card = list.locator("article", { hasText: "Omie Matriz" });
  await expect(card).toContainText("Acesso: ainda não informado");
  await expect(card).toContainText("Configurada, ainda não testada");

  // acesso: segredo vai uma vez e nunca volta
  await card.getByLabel("Chave do aplicativo (app key)").fill(SECRET_APP_KEY);
  await card.getByLabel("Segredo do aplicativo (app secret)").fill(SECRET_APP_SECRET);
  await card.getByRole("button", { name: "Guardar acesso" }).click();
  await expect(page.getByText("Acesso guardado com segurança.")).toBeVisible();
  await page.reload();
  await expect(card).toContainText("Acesso: informado");
  const html = await page.content();
  expect(html).not.toContain(SECRET_APP_KEY);
  expect(html).not.toContain(SECRET_APP_SECRET);
  const stored = sql(`select count(*) from fmcc_source_credential where tenant_id='${tenantId}'`);
  expect(Number(stored)).toBeGreaterThan(0);
  expect(sql(`select count(*) from fmcc_source_credential where tenant_id='${tenantId}' and position('${SECRET_APP_KEY}' in ciphertext)>0`)).toBe("0");

  // mapa de filiais
  await card.getByLabel("Campo do sistema que identifica a unidade (opcional)").fill("codigo_departamento");
  await card.getByRole("button", { name: "Adicionar linha" }).click();
  await card.getByLabel("Código no sistema").first().fill("D1");
  await card.locator("select").first().selectOption({ label: "Filial Centro" });
  await card.getByRole("button", { name: "Salvar mapa" }).click();
  await expect(page.getByText("Mapa de unidades salvo.")).toBeVisible();
  const cfg = sql(`select config::text from fmcc_source_definition where tenant_id='${tenantId}' and name='Omie Matriz'`);
  expect(cfg).toContain("D1");
  expect(cfg).toContain("codigo_departamento");
  await shot(page, "02-conexao-omie-pt");

  // teste de saúde e sincronização: sem rede real, a tela deve responder com estado claro, sem quebrar
  await card.getByRole("button", { name: "Testar conexão" }).click();
  // sem rede nem chave real do Omie, o teste de conexão deve falhar com mensagem na tela, sem quebrar
  await expect(page.getByText(/Saúde:|não pôde ser concluída/).first()).toBeVisible({ timeout: 40_000 });
  await card.getByRole("button", { name: "Sincronizar agora" }).click();
  await expect(page.getByText(/Sincronização concluída|A sincronização falhou|já está em andamento|não pôde ser concluída/)).toBeVisible({ timeout: 60_000 });
  await shot(page, "03-teste-e-sincronizacao-pt");

  // Conta Azul (OAuth) sem aplicativo registrado: mensagem honesta
  await catalog.locator("article", { hasText: "Conta Azul" }).getByRole("button", { name: "Conectar" }).click();
  await page.getByLabel("Nome desta conexão").fill("Conta Azul Matriz");
  await page.getByRole("button", { name: "Criar conexão" }).click();
  const ca = list.locator("article", { hasText: "Conta Azul Matriz" });
  await ca.getByRole("button", { name: "Autorizar no sistema" }).click();
  await expect(page.getByText("A autorização deste sistema ainda não foi configurada pelo administrador da plataforma.")).toBeVisible();
  await shot(page, "04-oauth-sem-config-pt");
});

test("tela de Fontes em inglês e no celular, sem rolagem lateral", async ({ page, context }) => {
  const { slug } = await signUpAndCreateOrganization(page);
  expect(slug).toBeTruthy();
  const base = new URL(page.url()).origin;
  await context.addCookies([{ name: "fm_locale", value: "en-US", url: base }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/sources");
  await expect(page.getByRole("heading", { name: "Sources and integrations" })).toBeVisible();
  await expect(page.getByText("Systems you can connect")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, "05-catalogo-en-mobile");
});
