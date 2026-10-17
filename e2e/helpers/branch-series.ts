import { execFileSync } from "node:child_process";
import { waitForAuthSlot } from "./auth-slot";
import type { Page } from "@playwright/test";

const SHOTS = process.env.FMCC_SHOTS_DIR;

export function sql(query: string): string {
  return execFileSync("psql", [process.env.DATABASE_URL!, "-At", "-c", query], { encoding: "utf8" }).trim();
}
export async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
export async function signUpAndCreateOrganization(page: Page) {
  await waitForAuthSlot();
  const suffix = `gfx-${Date.now()}`;
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

/** Cinco meses de vendas sintéticas: Curitiba cresce, Porto Alegre fica sem dado em um mês, Manaus nunca tem dado. */
export function seedBranchSeries(tenantId: string, METRIC: string, FACT: string, kind: "amount" | "count" = "amount") {
  const unit = (kind: string, parent: string | null, name: string) =>
    sql(`insert into fmcc_org_unit (tenant_id, parent_id, kind, name) values ('${tenantId}', ${parent ? `'${parent}'` : "null"}, '${kind}', '${name}') returning id`).split("\n")[0];
  const hq = unit("company", null, "Matriz Sintética");
  const sul = unit("region", hq, "Sul");
  const cwb = unit("branch", sul, "Curitiba");
  const poa = unit("branch", sul, "Porto Alegre");
  unit("branch", hq, "Manaus");
  const source = "gen_random_uuid()";
  const fact = (unitId: string, monthsBack: number, amount: number, n: number) => sql(`insert into fmcc_canonical_fact (tenant_id, unit_id, source_id, external_id, fact_type, payload, mapping_version, source_timestamp)
    values ('${tenantId}', '${unitId}', ${source}, 'e2e-${unitId}-${monthsBack}-${n}', '${FACT}', '{"amount": ${amount}, "currency": "BRL"}', 'v1', date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '${monthsBack} month' + interval '9 days 15 hours')`);
  // Modo contagem: valor/10.000 fatos distintos no mês (30.000 vira 3 eventos), porque a métrica conta eventos.
  const put = (unitId: string, monthsBack: number, amount: number) => {
    if (kind === "amount") { fact(unitId, monthsBack, amount, 1); return; }
    const count = Math.round(amount / 10000);
    for (let i = 0; i < count; i += 1) fact(unitId, monthsBack, 1, i);
  };
  const cwbByMonth = [30000, 34000, 41000, 39000, 52000, 21000];
  const poaByMonth = [22000, 25000, null, 31000, 36000, 14000];
  cwbByMonth.forEach((v, i) => put(cwb, 5 - i, v));
  poaByMonth.forEach((v, i) => { if (v !== null) put(poa, 5 - i, v); });
  const current = (unitId: string, v: string) => sql(`insert into fmcc_metric_value (tenant_id, unit_id, metric_id, metric_version, value, unit, currency, freshness_status, quality_status, source_authority)
    values ('${tenantId}', '${unitId}', '${METRIC}', 1, '${v}', '${kind === "count" ? "count" : "currency"}', ${kind === "count" ? "null" : "'BRL'"}, 'fresh', 'verified', 'sintetico')`);
  if (kind === "count") { current(cwb, "2"); current(poa, "1"); } else { current(cwb, "21000"); current(poa, "14000"); }
}

