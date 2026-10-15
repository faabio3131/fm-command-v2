import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("generic central billing product boundary", () => {
  it("persists product plan, SaaS tenant binding, product route and command idempotency as separate authorities", async () => {
    const schema = await readFile("src/infrastructure/db/billing-schema.ts", "utf8");
    expect(schema).toContain('fmcc_billing_product_plan');
    expect(schema).toContain('fmcc_billing_customer_binding');
    expect(schema).toContain('fmcc_billing_product_route');
    expect(schema).toContain('fmcc_billing_command_request');
    expect(schema).toContain('fmcc_billing_plan_scope_code_uq');
    expect(schema).toContain('fmcc_billing_customer_binding_external_uq');
    expect(schema).toContain('fmcc_billing_product_route_product_uq');
    expect(schema).toContain('fmcc_billing_command_idempotency_uq');
  });

  it("prepare API never accepts browser-provided amount or gateway account", async () => {
    const route = await readFile("src/app/api/billing/products/[productId]/prepare/route.ts", "utf8");
    expect(route).toContain('x-idempotency-key');
    expect(route).toContain('externalTenantId');
    expect(route).toContain('planCode');
    expect(route).not.toMatch(/input\.amountMinor|input\.gatewayAccountId/);
    expect(route).toContain('verifyPasswordStepUp');
    expect(route).toContain('billing.subscription_invoice.prepare');
  });

  it("plan and route writes require billing write authority and password step-up", async () => {
    const plans = await readFile("src/app/api/billing/products/[productId]/plans/route.ts", "utf8");
    const route = await readFile("src/app/api/billing/products/[productId]/route/route.ts", "utf8");
    expect(plans).toContain('verifyPasswordStepUp');
    expect(route).toContain('verifyPasswordStepUp');
    expect(plans).toContain('owner');
    expect(plans).toContain('admin');
    expect(route).toContain('owner');
    expect(route).toContain('admin');
  });
  it("serializes competing preparations for one external tenant before replay and live-subscription checks", async () => {
    const repository = await readFile("src/infrastructure/billing/postgres-product-billing-authority-repository.ts", "utf8");
    const preparation = repository.slice(repository.indexOf("async prepareSubscriptionInvoice("));
    const lock = preparation.indexOf("pg_advisory_xact_lock(hashtextextended");
    const replay = preparation.indexOf("const [replay]");
    const live = preparation.indexOf("const [live]");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(replay);
    expect(replay).toBeLessThan(live);
    expect(preparation).toContain("input.tenantId,");
    expect(preparation).toContain("input.productId,");
    expect(preparation).toContain("input.externalTenantId,");
    expect(preparation).toContain("fmcc.billing.subscription.v1");
  });

});
