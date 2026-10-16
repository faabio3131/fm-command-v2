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
  const suffix = `rep-${Date.now()}`;
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

test("tela de Relatórios: criar, enviar agora pelo canal simulado, exportar CSV, desligar e remover", async ({ page }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);

  // Canal de e-mail simulado com um destinatário.
  await page.goto("/dashboard/channels");
  const email = page.locator('[data-channel="email"]');
  await email.getByLabel("Remetente").fill("relatorios@fm.test");
  await email.getByLabel("Canal ligado").check();
  await email.getByRole("button", { name: "Salvar canal" }).click();
  await expect(email.getByText("Canal salvo.")).toBeVisible();
  await email.getByLabel("Endereço").fill("diretoria@empresa.com");
  await email.getByRole("button", { name: "Adicionar" }).click();
  await expect(email.getByText("diretoria@empresa.com")).toBeVisible();

  await page.goto("/dashboard/reports");
  await expect(page.getByRole("heading", { name: "Relatórios", level: 1 })).toBeVisible();
  await expect(page.getByText("Nenhum relatório criado.")).toBeVisible();

  // Sem métrica marcada não cria.
  const form = page.locator("form").filter({ hasText: "Criar relatório" });
  await form.getByLabel("Nome", { exact: true }).fill("Diretoria semanal");
  await form.getByRole("button", { name: "Criar relatório" }).click();
  await expect(page.getByText("Não foi possível criar.")).toBeVisible();

  await form.getByLabel("Caixa recebido").check();
  await form.getByLabel("Testes gratuitos iniciados").check();
  await form.getByLabel("Frequência").selectOption("weekly");
  await form.getByLabel("Dia da semana").selectOption("5");
  await form.getByRole("button", { name: "Criar relatório" }).click();
  const item = page.locator('[data-report="Diretoria semanal"]');
  await expect(item).toContainText("Sexta-feira, às 8h");
  await expect(item).toContainText("Ainda não enviado");

  await item.getByRole("button", { name: "Enviar agora" }).click();
  await expect(item.getByText("Envios criados: 1.")).toBeVisible();
  expect(sql(`select count(*) from fmcc_channel_delivery where tenant_id='${tenantId}' and source_type='report' and status='sent'`)).toBe("1");

  // Exportação: a rota devolve CSV com cabeçalho, indisponível (sem dado) e proteção; sem métrica válida, erro 400.
  const csv = await page.evaluate(async () => {
    const r = await fetch("/api/reports/export?metrics=revenue.cash_collected,trial.starts.count");
    return { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), body: await r.text() };
  });
  expect(csv.status).toBe(200);
  expect(csv.type).toContain("text/csv");
  expect(csv.cache).toBe("no-store");
  expect(csv.body).toContain("metric_id,metric,status,value");
  expect(csv.body).toContain("revenue.cash_collected,Caixa recebido,unavailable,");
  expect((await page.request.get("/api/reports/export?metrics=nao.existe")).status()).toBe(400);
  expect((await page.request.get("/api/reports/export")).status()).toBe(400);

  await page.locator("[data-export='revenue.cash_collected']").check();
  await expect(page.getByRole("link", { name: "Baixar CSV" })).toHaveAttribute("href", "/api/reports/export?metrics=revenue.cash_collected");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/reports.png`, fullPage: true });

  await item.getByRole("button", { name: "Desligar" }).click();
  await expect(item.getByRole("button", { name: "Ligar" })).toBeVisible();
  await item.getByRole("button", { name: "Remover" }).click();
  await expect(page.getByText("Nenhum relatório criado.")).toBeVisible();
});

test("tela de Relatórios em inglês", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.addCookies([{ name: "fm_locale", value: "en-US", url: "http://127.0.0.1:" + (process.env.FMCC_E2E_PORT ?? "3000") }]);
  await waitForAuthSlot();
  const suffix = `rep-en-${Date.now()}`;
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
  await page.goto("/dashboard/reports");
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  await expect(page.getByText("No reports yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create report" })).toBeVisible();
});
