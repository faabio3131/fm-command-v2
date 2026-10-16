import { execFileSync } from "node:child_process";
import { waitForAuthSlot } from "./helpers/auth-slot";
import { expect, test, type Page } from "@playwright/test";
import { enUS } from "../src/i18n/messages/en-US";
import { ptBR } from "../src/i18n/messages/pt-BR";

test.use({ locale: "en-US" });
const SHOTS = process.env.FMCC_SHOTS_DIR;

const SCREENS: readonly { path: string; heading: keyof typeof enUS }[] = [
  { path: "/dashboard", heading: "home.overview.title" },
  { path: "/dashboard/notifications", heading: "notifications.page.title" },
  { path: "/dashboard/activity", heading: "activity.title" },
  { path: "/dashboard/alerts", heading: "alerts.title" },
  { path: "/dashboard/settings", heading: "settings.title" },
  { path: "/dashboard/search?q=revenue", heading: "search.title" },
  { path: "/dashboard/trials", heading: "trials.title" },
  { path: "/dashboard/subscriptions", heading: "subs.title" },
  { path: "/dashboard/finance", heading: "finance.title" },
  { path: "/dashboard/customers", heading: "customers.title" },
  { path: "/dashboard/growth", heading: "growth.title" },
  { path: "/dashboard/intelligence", heading: "intel.title" },
  { path: "/dashboard/operations", heading: "ops.title" },
];

async function signUpAndCreateOrganization(page: Page) {
  await waitForAuthSlot();
  const suffix = `en-${Date.now()}`;
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
  return suffix;
}

/**
 * Português conhecido e FORA do escopo da 9T: texto gerado por serviços de domínio
 * (resultados da busca; notas/razões de inteligência). Lista explícita, não silenciosa:
 * qualquer vazamento fora dela reprova o teste.
 */
const KNOWN_DOMAIN_TEXT: readonly RegExp[] = [
  /^\/dashboard\/search\?q=revenue: /,
  /^\/dashboard\/intelligence: intel\.correlation /,
  // o rótulo já é traduzido; sobra a palavra dentro da frase `reason` do serviço de operações
  /^\/dashboard\/operations: label\.metricName\.service\.availability\.rate /,
];

/** Textos em português do catálogo que, em inglês, não podem aparecer na tela. */
const PT_ONLY = Object.entries(ptBR).filter(([key, pt]) => {
  const en = (enUS as Record<string, string>)[key];
  return en !== undefined && en !== pt && pt.length >= 10 && !pt.includes("{");
});

test("telas do painel em inglês: título certo e nenhum texto em português dos catálogos", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = await signUpAndCreateOrganization(page);
  const timeZone = "Pacific/Auckland";
  execFileSync("psql", [process.env.DATABASE_URL!, "-At", "-c",
    `insert into fmcc_org_profile (tenant_id, default_locale, country_code, currency, timezone, updated_by)
     select id, 'en-US', 'NZ', 'NZD', '${timeZone}', 'e2e' from auth_organization where slug = 'org-${suffix}'`]);

  const leaks: string[] = [];
  for (const screen of SCREENS) {
    const response = await page.goto(screen.path);
    expect(response?.status(), screen.path).toBeLessThan(400);
    await expect(page.locator("main").getByText(enUS[screen.heading], { exact: false }).first(), screen.path).toBeVisible();
    const text = await page.locator("body").innerText();
    for (const [key, pt] of PT_ONLY) if (text.includes(pt)) leaks.push(`${screen.path}: ${key} -> "${pt}"`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/en-${screen.path.replace(/[^a-z]+/gi, "_")}.png`, fullPage: true });
  }
  expect(leaks.filter((leak) => !KNOWN_DOMAIN_TEXT.some((known) => known.test(leak)))).toEqual([]);
});
