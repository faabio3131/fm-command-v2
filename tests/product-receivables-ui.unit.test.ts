import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("R7 Receivables UI/API contract", () => {
  it("expõe Recebimentos no cockpit somente com RBAC próprio", () => {
    const cockpit = source("src/app/dashboard/products/[productId]/page.tsx");
    expect(cockpit).toContain(
      'roleHasPermission(context.role, "receivable:read")',
    );
    expect(cockpit).toContain("/receivables");
  });

  it("deixa explícito que fatura, vencimento, saldo e inadimplência não são inferidos", () => {
    const page = source(
      "src/app/dashboard/products/[productId]/receivables/page.tsx",
    );
    expect(page).toContain("Faturas");
    expect(page).toContain("Saldo em aberto");
    expect(page).toContain("Data de vencimento da fatura");
    expect(page).toContain("Valor inadimplente");
    expect(page).toContain("não é convertida em valor inadimplente");
    expect(page).toContain("representa saldo aberto ou dívida");
  });

  it("resolve tenant server-side na API e não aceita tenant do cliente", () => {
    const api = source(
      "src/app/api/products/[productId]/receivables/route.ts",
    );
    expect(api).toContain("resolveTenantContext(await headers())");
    expect(api).not.toContain("x-tenant-id");
    expect(api).not.toContain("tenantId?:");
  });
});
