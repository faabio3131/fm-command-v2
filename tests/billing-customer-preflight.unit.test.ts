import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("billing customer preflight", () => {
  it("normalizes and validates CPF/CNPJ before provider customer reconciliation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/billing/checkout/pilot/issue/route.ts"),
      "utf8",
    );
    expect(source).toContain('body.cpfCnpj.replace(/\\D/g,"")');
    expect(source).toContain("billing.customer_document_invalid");
    expect(source).toContain("reconcileCustomer");
    expect(source).toContain("billing_pilot_customer_preflight_started");
    expect(source).toContain("billing_pilot_customer_preflight_succeeded");
  });

  it("updates stale provider customer id only after successful reconciliation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/billing/checkout/pilot/issue/route.ts"),
      "utf8",
    );
    expect(source).toContain("externalId !== customer.externalId");
    expect(source).toContain("externalCustomerId:externalId");
    expect(source).toContain("billing.customer_concurrent_change");
  });

  it("documents CPF/CNPJ formatting and digit counts in checkout UI", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/dashboard/billing/pilot-checkout.tsx"),
      "utf8",
    );
    expect(source).toContain("billing-document-help");
    expect(source).toContain("com ou sem pontos, traços e barra");
    expect(source).toContain("CPF deve ter 11 dígitos; CNPJ, 14");
    expect(source).toContain("maxLength={18}");
  });
});
