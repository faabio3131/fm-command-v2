import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";

/**
 * Revisão de segurança: toda tabela do banco guarda de qual empresa é o dado, salvo as globais por desenho (abaixo).
 * Tabela nova sem coluna de empresa quebra este teste e obriga a decidir: ou ganha a coluna, ou entra aqui com o motivo.
 */
const GLOBAL_BY_DESIGN: Record<string, string> = {
  auth_user: "pessoa (identidade); a empresa vem do vínculo de organização",
  auth_session: "sessão da pessoa",
  auth_account: "login da pessoa",
  auth_verification: "token de verificação da pessoa",
  auth_organization: "é a própria empresa",
  fmcc_ai_provider: "provedores de IA do ambiente (sem dado de empresa; vínculo por empresa fica em tabela com tenant_id)",
  fmcc_saas_plan: "catálogo de planos da plataforma",
  fmcc_saas_plan_price: "preço por moeda do catálogo",
  fmcc_saas_fee_schedule: "taxas por meio de cobrança, da plataforma",
  fmcc_saas_payment_route: "rota de cobrança por país/moeda, da plataforma",
  fmcc_saas_event: "avisos do provedor de pagamento, aplicados pela assinatura gravada (a empresa vem dela)",
  fmcc_user_preference: "preferência da pessoa",
};

describe("revisão de segurança: todo dado de empresa tem coluna de empresa", () => {
  it("só as tabelas globais declaradas ficam sem tenant_id/organization_id", async () => {
    const rows = await db.execute(sql`
      select t.table_name as name from information_schema.tables t
      where t.table_schema='public' and t.table_type='BASE TABLE'
        and not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name and c.column_name in ('tenant_id','organization_id'))
      order by 1`);
    const list = Array.isArray(rows) ? rows : (rows as unknown as { rows: unknown[] }).rows;
    const without = (list as { name: string }[]).map((r) => r.name);
    expect(without.filter((n) => !(n in GLOBAL_BY_DESIGN))).toEqual([]);
    // E a lista de exceções não esconde tabela que já ganhou a coluna (não deixa a exceção apodrecer).
    expect(Object.keys(GLOBAL_BY_DESIGN).filter((n) => !without.includes(n))).toEqual([]);
  });
});
