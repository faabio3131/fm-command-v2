import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("R6 Product Billing control plane", () => {
  it("restringe a superfície de Billing a permissões financeiras próprias", () => {
    const billingPage = source(
      "src/app/dashboard/products/[productId]/billing/page.tsx",
    );
    const cockpit = source(
      "src/app/dashboard/products/[productId]/page.tsx",
    );
    const service = source(
      "src/application/integration/kordena-billing-control-service.ts",
    );
    const api = source(
      "src/app/api/integrations/kordena-commercial/billing/route.ts",
    );

    expect(billingPage).toContain(
      'roleHasPermission(context.role, "billing:read")',
    );
    expect(billingPage).toContain(
      'roleHasPermission(context.role, "billing:write")',
    );
    expect(cockpit).toContain(
      'roleHasPermission(context.role, "billing:read")',
    );
    expect(service).toContain('requirePermission(context, "billing:read")');
    expect(service).toContain('requirePermission(context, "billing:write")');
    expect(api).toContain('PermissionDeniedError("billing:write")');
  });

  it("deriva o código do produto governado e não hardcodeia KORDENA na rota por produto", () => {
    const billingPage = source(
      "src/app/dashboard/products/[productId]/billing/page.tsx",
    );

    expect(billingPage).toContain("productCode={product.slug.toUpperCase()}");
    expect(billingPage).not.toContain('productCode="KORDENA"');
  });

  it("mantém step-up, idempotência e auditoria sem registrar payload sensível", () => {
    const api = source(
      "src/app/api/integrations/kordena-commercial/billing/route.ts",
    );

    expect(api).toContain("verifyPasswordStepUp");
    expect(api).toContain('requestHeaders.get("idempotency-key")');
    expect(api).toContain("commercial.billing.command.forwarded");
    expect(api).toContain("commandAction: body.action");
    expect(api).not.toContain("metadata: { payload:");
    expect(api).not.toContain("metadata: body.payload");
  });

  it("falha fechado quando a fonte/control plane externo não está disponível", () => {
    const billingPage = source(
      "src/app/dashboard/products/[productId]/billing/page.tsx",
    );

    expect(billingPage).toContain("Fonte comercial não conectada");
    expect(billingPage).toContain("Billing indisponível");
    expect(billingPage).toContain("Nenhuma configuração financeira será presumida");
  });
});
