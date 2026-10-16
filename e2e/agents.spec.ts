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
  const suffix = `agt-${Date.now()}`;
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

test("tela de Agentes: orçamento, rascunho, aprovação humana e envio pelo canal", async ({ page }) => {
  test.setTimeout(120_000);
  const tenantId = await signUpAndCreateOrganization(page);

  // Canal de e-mail simulado com um destinatário.
  await page.goto("/dashboard/channels");
  const email = page.locator('[data-channel="email"]');
  await email.getByLabel("Remetente").fill("agente@fm.test");
  await email.getByLabel("Canal ligado").check();
  await email.getByRole("button", { name: "Salvar canal" }).click();
  await expect(email.getByText("Canal salvo.")).toBeVisible();
  await email.getByLabel("Endereço").fill("diretoria@empresa.com");
  await email.getByRole("button", { name: "Adicionar" }).click();
  await expect(email.getByText("diretoria@empresa.com")).toBeVisible();

  await page.goto("/dashboard/agents");
  await expect(page.getByRole("heading", { name: "Agentes", level: 1 })).toBeVisible();
  await expect(page.getByText("Orçamento ainda não definido: o agente fica desligado.")).toBeVisible();

  // Sem orçamento ligado, o pedido é recusado.
  await page.getByRole("button", { name: "Gerar rascunho da semana" }).click();
  await expect(page.getByText("O agente está desligado ou sem orçamento definido.")).toBeVisible();

  // Liga com teto e pede o rascunho.
  await page.getByLabel("Agente ligado").check();
  await page.getByLabel("Teto do mês (unidade menor, ex.: centavos)").fill("500");
  await page.getByLabel("Reserva por rascunho (unidade menor)").fill("25");
  await page.getByRole("button", { name: "Salvar orçamento" }).click();
  await expect(page.getByText("Orçamento salvo.")).toBeVisible();
  await page.getByRole("button", { name: "Gerar rascunho da semana" }).click();
  const generating = page.locator('[data-draft="generating"]');
  await expect(generating).toBeVisible();

  // Nenhum envio enquanto não há aprovação.
  expect(sql(`select count(*) from fmcc_channel_delivery where tenant_id='${tenantId}'`)).toBe("0");

  // O trabalhador de IA termina a tarefa (aqui simulado pelo resultado na fila; o fluxo real com provedor está nos testes de integração).
  sql(`update fmcc_work_item set state='succeeded', lease_token=null, lease_until=null, result='{"text":"Resumo escrito pelo agente. Tudo indisponível por enquanto."}'::jsonb where tenant_id='${tenantId}' and task_type='synthesis'`);
  await page.reload();
  const ready = page.locator('[data-draft="ready"]');
  await expect(ready).toContainText("Aguardando a sua aprovação");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-ready.png`, fullPage: true });
  expect(sql(`select count(*) from fmcc_channel_delivery where tenant_id='${tenantId}'`)).toBe("0");

  // A pessoa edita e aprova: só então sai.
  await ready.getByLabel("Texto").fill("Texto revisado pelo diretor.");
  await ready.getByRole("button", { name: "Aprovar e enviar" }).click();
  await expect(page.locator('[data-draft="sent"]')).toContainText("Enviado");
  await expect(page.locator('[data-draft="sent"]')).toContainText("Texto revisado pelo diretor.");
  expect(sql(`select count(*) from fmcc_channel_delivery where tenant_id='${tenantId}' and source_type='agent_draft'`)).toBe("1");
});

test.describe("en-US", () => {
  test.use({ locale: "en-US" });
  test("Agents screen in English", async ({ page }) => {
    test.setTimeout(120_000);
    await waitForAuthSlot();
    const suffix = `agt-en-${Date.now()}`;
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
    await page.goto("/dashboard/agents");
    await expect(page.getByRole("heading", { name: "Agents", level: 1 })).toBeVisible();
    await expect(page.getByText("No budget set yet: the agent stays off.")).toBeVisible();
    await page.getByRole("button", { name: "Generate this week's draft" }).click();
    await expect(page.getByText("The agent is off or has no budget set.")).toBeVisible();
    await expect(page.getByText("No drafts yet.")).toBeVisible();
  });
});
