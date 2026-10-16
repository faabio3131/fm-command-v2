import { expect, test, type Page } from "@playwright/test";

let sequence = 0;

function unique(prefix: string) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

async function signUpAndCreateOrganization(page: Page, prefix: string) {
  const suffix = unique(prefix);
  const email = `${suffix}@example.com`;
  const password = "E2e-FMCC-12345!";
  const organizationName = `Organização ${suffix}`;
  const organizationSlug = `org-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Criar uma conta" }).click();
  await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();

  await page.getByLabel("Nome").fill(`Usuário ${suffix}`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();

  await page.waitForURL(/\/onboarding$/);
  await page.getByLabel("Nome da organização").fill(organizationName);
  await page.getByLabel("Identificador").fill(organizationSlug);
  await page.getByRole("button", { name: "Criar organização" }).click();

  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "FM Command", exact: true })).toBeVisible();

  return { email, password, organizationName, organizationSlug };
}

async function createProduct(page: Page, name: string, slug: string) {
  const form = page.locator("form.product-create-form");
  await form.getByLabel("Produto").fill(name);
  await form.getByLabel("Identificador").fill(slug);
  await form.getByRole("button", { name: "Cadastrar produto" }).click();
  const productSection = page.locator('[aria-labelledby="product-intelligence-title"]');
  const productLink = productSection.getByRole("link", { name: new RegExp(name) });
  await expect(productLink).toBeVisible();
  return productLink.getAttribute("href");
}


test("abertura premium do FM Command exibe o Core e permanece responsiva", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/sign-in");

  const approvedArtwork = page.getByRole("img", { name: "FM Command" });
  await expect(approvedArtwork).toBeVisible();
  await expect(approvedArtwork).toHaveCSS("mix-blend-mode", "screen");
  await expect
    .poll(() =>
      approvedArtwork.evaluate((image) => ({
        complete: (image as HTMLImageElement).complete,
        width: (image as HTMLImageElement).naturalWidth,
        height: (image as HTMLImageElement).naturalHeight,
        source: (image as HTMLImageElement).currentSrc,
      })),
    )
    .toMatchObject({
      complete: true,
      width: 650,
      height: 650,
      source: expect.stringContaining("data:image/webp;base64,"),
    });
  await expect(page.getByRole("heading", { name: "Acesse sua conta" })).toBeVisible();
  await expect(page.getByText("Comande sua operação com")).toBeVisible();
  await expect(page.getByText("inteligência governada.")).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();

  let hasCriticalHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasCriticalHorizontalOverflow).toBe(false);
  const desktopLayout = await page.evaluate(() => {
    const hero = document.querySelector(".command-auth-hero")?.getBoundingClientRect();
    const copy = document.querySelector(".command-auth-copy")?.getBoundingClientRect();
    const artwork = document.querySelector(".command-approved-artwork")?.getBoundingClientRect();
    const card = document.querySelector(".command-auth-card")?.getBoundingClientRect();
    const benefits = document.querySelector(".command-auth-benefits")?.getBoundingClientRect();

    return {
      hero,
      copy,
      artwork,
      card,
      benefits,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  expect(desktopLayout.copy).toBeTruthy();
  expect(desktopLayout.artwork).toBeTruthy();
  expect(desktopLayout.card).toBeTruthy();
  expect(desktopLayout.benefits).toBeTruthy();
  expect(desktopLayout.copy!.height).toBeLessThan(360);
  expect(desktopLayout.artwork!.width).toBeLessThanOrEqual(410);
  expect(desktopLayout.card!.width).toBeLessThanOrEqual(450);
  expect(desktopLayout.card!.right).toBeLessThanOrEqual(desktopLayout.viewportWidth);
  expect(desktopLayout.card!.bottom).toBeLessThanOrEqual(desktopLayout.viewportHeight);
  expect(desktopLayout.benefits!.bottom).toBeLessThanOrEqual(desktopLayout.viewportHeight + 1);


  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("img", { name: "FM Command" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();

  hasCriticalHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasCriticalHorizontalOverflow).toBe(false);
});

test("viewports desktop oficiais 1920x1080 e 1366x768 mantêm dashboard premium sem overflow horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await signUpAndCreateOrganization(page, "desktop-official");

  await expect(page.getByRole("heading", { name: "FM Command", exact: true })).toBeVisible();
  await expect(page.getByText("FM COMMAND CORE", { exact: true })).toBeVisible();

  let hasCriticalHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasCriticalHorizontalOverflow).toBe(false);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.reload();

  await expect(page.getByRole("heading", { name: "FM Command", exact: true })).toBeVisible();
  await expect(page.getByText("FM COMMAND CORE", { exact: true })).toBeVisible();

  hasCriticalHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasCriticalHorizontalOverflow).toBe(false);
});


test("autenticação, onboarding, logout/login e Kordena fail-closed", async ({ page }) => {
  const identity = await signUpAndCreateOrganization(page, "auth");

  await expect(page.getByText("Cobertura factual")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Kordena Comercial/ }),
  ).toHaveCount(0);
  await page.goto("/dashboard/commercial/kordena");
  await expect(page.getByText("Fonte Kordena ainda não configurada.")).toBeVisible();
  await expect(page.getByText("Nenhum dado será presumido.")).toBeVisible();

  await page.getByRole("link", { name: "Voltar" }).click();
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/\/sign-in$/);

  await page.getByLabel("E-mail").fill(identity.email);
  await page.getByLabel("Senha").fill(identity.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "FM Command", exact: true })).toBeVisible();
});

test("alertas: criação, ausência fail-closed, duplicata, desativação e arquivo", async ({ page }) => {
  await signUpAndCreateOrganization(page, "alerts");
  await page.goto("/dashboard/alerts");

  await page.getByLabel("Métrica").selectOption("trial.starts.count");
  await page.getByLabel("Produto").selectOption("");
  await page.getByLabel("Operador").selectOption("gt");
  await page.getByLabel("Limite").fill("10");
  await page.getByLabel("Severidade").selectOption("warning");
  await page.getByRole("button", { name: "Criar regra" }).click();

  let rule = page.locator("article.alert-item").filter({ hasText: "Testes gratuitos iniciados" }).first();
  await expect(rule).toContainText("Ativa");

  await rule.getByRole("button", { name: "Avaliar agora" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Avaliação concluída: métrica indisponível; nenhum alerta criado.",
  );

  await page.getByLabel("Limite").fill("10");
  await page.getByRole("button", { name: "Criar regra" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Já existe uma regra ativa equivalente.",
  );

  rule = page.locator("article.alert-item").filter({ hasText: "Testes gratuitos iniciados" }).first();
  await rule.getByRole("button", { name: "Desativar" }).click();

  rule = page.locator("article.alert-item").filter({ hasText: "Testes gratuitos iniciados" }).first();
  await expect(rule).toContainText("Desativada");
  await expect(rule.getByRole("button", { name: "Avaliar agora" })).toHaveCount(0);
  await rule.getByRole("button", { name: "Arquivar" }).click();

  await expect(page.getByText("Histórico arquivado (1)")).toBeVisible();
  await page.getByText("Histórico arquivado (1)").click();
  await page.getByRole("link", { name: /Abrir arquivo/ }).click();

  const stateCard = page.locator("article.metric-card").filter({ hasText: "Estado" });
  await expect(stateCard.getByText("Arquivada", { exact: true })).toBeVisible();
  await expect(page.getByText("Nenhuma ocorrência histórica.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar nova regra baseada nesta" })).toBeVisible();
});

test("isolamento cross-tenant bloqueia acesso direto ao produto de outra organização", async ({ browser }) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await signUpAndCreateOrganization(pageA, "tenant-a");

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await signUpAndCreateOrganization(pageB, "tenant-b");
  const productSlug = unique("produto-b").toLowerCase();
  const productHref = await createProduct(pageB, "Produto exclusivo B", productSlug);
  expect(productHref).toBeTruthy();

  const response = await pageA.goto(productHref!);
  expect(response?.status()).toBe(404);

  await contextA.close();
  await contextB.close();
});

test("viewport móvel crítico mantém alertas utilizáveis sem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUpAndCreateOrganization(page, "mobile");
  await page.goto("/dashboard/alerts");

  await expect(page.getByRole("heading", { name: /Central de atenção governada/ })).toBeVisible();
  await expect(page.getByLabel("Métrica")).toBeVisible();
  await expect(page.getByLabel("Limite")).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar regra" })).toBeVisible();

  const hasCriticalHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasCriticalHorizontalOverflow).toBe(false);
});


test("viewport de tablet crítico mantém dashboard e alertas utilizáveis sem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await signUpAndCreateOrganization(page, "tablet");

  await expect(page.getByRole("heading", { name: "FM Command", exact: true })).toBeVisible();
  let hasCriticalHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasCriticalHorizontalOverflow).toBe(false);

  await page.goto("/dashboard/alerts");
  await expect(page.getByRole("heading", { name: /Central de atenção governada/ })).toBeVisible();
  await expect(page.getByLabel("Métrica")).toBeVisible();
  await expect(page.getByLabel("Limite")).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar regra" })).toBeVisible();

  hasCriticalHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasCriticalHorizontalOverflow).toBe(false);
});


test("fontes: cadastro governado do Kordena permanece fail-closed sem runtime externo", async ({ page }) => {
  await signUpAndCreateOrganization(page, "sources");
  const productSlug = "kordena";
  await createProduct(page, "Kordena", productSlug);

  await page.goto("/dashboard/sources");
  await expect(page.getByRole("heading", { name: "Fontes e Integrações" })).toBeVisible();

  await page.locator('select[name="productId"]').selectOption({ index: 1 });
  await page.getByLabel("URL HTTPS do Kordena").fill("https://kordena.example.test");
  await page.getByLabel("Atualidade esperada (segundos)").fill("300");
  await page.getByRole("button", { name: "Cadastrar fonte" }).click();

  await expect(page.getByText("Fonte Kordena cadastrada. Teste a conexão antes de sincronizar.")).toBeVisible();
  const sourceCard = page.locator("article.product-card").filter({ hasText: "Kordena Commercial" });
  await expect(sourceCard).toBeVisible();

  await sourceCard.getByRole("button", { name: "Testar conexão" }).click();
  await expect(sourceCard.getByRole("status")).toContainText("Saúde: Indisponível");

  await sourceCard.getByRole("button", { name: "Sincronizar agora" }).click();
  await expect(
    sourceCard.getByText(
      "A sincronização falhou ou a configuração externa ainda não está pronta.",
      { exact: true },
    ),
  ).toBeVisible();
});
