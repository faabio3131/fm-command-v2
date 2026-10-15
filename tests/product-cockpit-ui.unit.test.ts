import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("R5 Product Cockpit UI/API contract", () => {
  it("página individual usa o read model governado do cockpit", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/dashboard/products/[productId]/page.tsx"),
      "utf8",
    );

    expect(source).toContain("R5 · Product Cockpit");
    expect(source).toContain("buildProductCockpitService");
    expect(source).toContain("Cobertura factual");
    expect(source).toContain("Aquisição e crescimento");
    expect(source).toContain("Receita, caixa e custos");
    expect(source).toContain("Engajamento e suporte");
    expect(source).toContain("Saúde e sinais operacionais");
    expect(source).toContain("Fontes atribuídas ao produto");
    expect(source).toContain("Atenção governada do produto");
    expect(source).toContain("Billing & Recebimentos");
    expect(source).toContain("Core contextual");
    expect(source).toContain("productContext={{");
    expect(source).toContain("Tendências governadas");
    expect(source).toContain("nunca zero presumido");
    expect(source).not.toContain("product.performance.score");
  });

  it("Core contextual envia scope explícito e a API cognitiva valida o campo", () => {
    const form = readFileSync(
      resolve(process.cwd(), "src/app/dashboard/core-query-form.tsx"),
      "utf8",
    );
    const api = readFileSync(
      resolve(process.cwd(), "src/app/api/core/query/route.ts"),
      "utf8",
    );

    expect(form).toContain("productSlugs: [productContext.slug]");
    expect(form).toContain("Contexto governado:");
    expect(api).toContain("productSlugs?: unknown");
    expect(api).toContain("buildCoreGateway().ask(context, body.question");
  });

  it("API do cockpit resolve tenant server-side e não aceita tenant do cliente", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/products/[productId]/cockpit/route.ts"),
      "utf8",
    );

    expect(source).toContain("resolveTenantContext(await headers())");
    expect(source).toContain("buildProductCockpitService().overview");
    expect(source).not.toContain("X-Tenant");
    expect(source).not.toContain("tenantId:");
  });
});
