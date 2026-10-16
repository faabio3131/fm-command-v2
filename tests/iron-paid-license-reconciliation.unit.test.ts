import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  IronPaidLicenseReconciliationService,
  type PaidIronInvoiceRepository,
  type VerifiedIronPayment,
} from "@/application/billing/iron-paid-license-reconciliation-service";
import type { IronCommercialConnector } from "@/infrastructure/integration/iron-commercial-connector";
import type { SourceDefinition } from "@/domain/integration/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

const gymId = "42ee4cae-766e-40a2-a77b-24da359bc031";
const invoiceId = "54ef6e5c-59c9-4301-b7b7-ad2c4343ef35";
const productId = "69091bb5-8907-4d7d-957c-1bd95d038b92";
const ironSubscriptionId = "9860a799-f776-474a-a2b4-514bedb53dce";
const context: TenantContext = {
  tenantId: "fm-owner-tenant", userId: "operator-1",
  role: "owner", correlationId: "corr-iron-paid-1",
};
const source: SourceDefinition = {
  id: "source-iron",
  tenantId: context.tenantId,
  productId,
  name: "IRON FIT CORE Commercial",
  sourceType: "iron-commercial-v1",
  authoritativeDomain: "commercial",
  status: "configured",
  syncMode: "pull",
  secretRef: "env:FMCC_IRON_CONTROL_PLANE_TOKEN",
  config: {
    baseUrl: "https://iron.example.test",
    ironCommercialPlanMappings: {
      schemaVersion: "iron.commercial-plan-mappings.v1",
      mappings: [{
        revision: 1,
        commercialPlanCode: "IRON_V1_MONTHLY",
        ironPlanCode: "IRON_V1_MONTHLY",
        ironPlanVersion: 1,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      }],
    },
  },
  freshnessSeconds: 300,
  mappingVersion: "iron-commercial-v1",
};
const payment: VerifiedIronPayment = {
  tenantId: context.tenantId, productId, invoiceId,
  invoiceCreatedAt: "2026-10-12T12:00:00.000Z",
  externalTenantId: gymId, planCode: "IRON_V1_MONTHLY",
  amountMinor: 26900, paymentId: "pay-proven",
  invoiceStatus: "paid", paymentStatus: "received",
  gatewayEnvironment: "production", productSlug: "iron",
};
function setup(override: Partial<VerifiedIronPayment> = {}, rows?: unknown[]) {
  const repo: PaidIronInvoiceRepository = {
    findVerifiedProductionPayment: vi.fn(async () => ({ ...payment, ...override })),
  };
  const connector = {
    snapshot: vi.fn(async () => ({
      product_code: "IRON_FIT_CORE",
      coverage: { subscription_projection: "IRON_CANONICAL" },
      subscriptions: rows ?? [{
        tenant_id: gymId, external_id: ironSubscriptionId, status: "ACTIVE",
        plan_code: "IRON_V1_MONTHLY", plan_version: 1, effective_until: null,
      }],
    })),
    subscriptionCommand: vi.fn(async () => ({ idempotent: false, result: { entitlementStatus: "ACTIVE" } })),
  };
  const service = new IronPaidLicenseReconciliationService(
    repo, connector as unknown as Pick<IronCommercialConnector, "snapshot" | "subscriptionCommand">,
  );
  return { repo, connector, service };
}

describe("D11 IRON production payment to license gate", () => {
  it("reads authoritative paid invoice then targets only the matching gym/plan", async () => {
    const { repo, connector, service } = setup();
    const result = await service.reconcile(context, source, productId, invoiceId);
    expect(repo.findVerifiedProductionPayment).toHaveBeenCalledWith(context.tenantId, productId, invoiceId);
    expect(connector.subscriptionCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: context.tenantId }),
      source,
      expect.objectContaining({
        action: "subscription.status.sync",
        gymId, expectedSubscriptionId: ironSubscriptionId,
        commercialStatus: "active", entitlementStatus: "ACTIVE",
      }),
      "fmcc:verified-paid:v1:" + invoiceId,
    );
    expect(result.gymId).toBe(gymId);
  });

  it.each([
    ["invoice pending", { invoiceStatus: "pending" }],
    ["provider pending", { paymentStatus: "pending" }],
    ["sandbox provider", { gatewayEnvironment: "sandbox" }],
    ["wrong product", { productId: "other" }],
    ["wrong FM tenant", { tenantId: "other" }],
    ["zero amount", { amountMinor: 0 }],
    ["unknown payment", { paymentId: "" }],
    ["wrong product slug", { productSlug: "kordena" }],
    ["invalid gym binding", { externalTenantId: "gym-user-entered" }],
  ])("fails closed for %s without contacting IRON", async (_name, altered) => {
    const { connector, service } = setup(altered);
    await expect(service.reconcile(context, source, productId, invoiceId)).rejects.toThrow();
    expect(connector.snapshot).not.toHaveBeenCalled();
    expect(connector.subscriptionCommand).not.toHaveBeenCalled();
  });

  it("blocks cross-product source, plan mismatch, multiple subscriptions and canceled history", async () => {
    const wrong = { ...source, productId: "different" };
    const a = setup();
    await expect(a.service.reconcile(context, wrong, productId, invoiceId)).rejects.toThrow("billing.iron_source_scope_denied");
    expect(a.connector.subscriptionCommand).not.toHaveBeenCalled();

    const wrongPlan = setup({}, [{
      tenant_id: gymId, external_id: ironSubscriptionId, status: "ACTIVE", plan_code: "OTHER", plan_version: 1,
    }]);
    await expect(wrongPlan.service.reconcile(context, source, productId, invoiceId))
      .rejects.toThrow("billing.iron_plan_mapping_unavailable");
    expect(wrongPlan.connector.subscriptionCommand).not.toHaveBeenCalled();

    const duplicate = setup({}, Array.from({ length: 2 }, (_, i) => ({
      tenant_id: gymId, external_id: ironSubscriptionId + i, status: "ACTIVE", plan_code: "IRON_V1_MONTHLY", plan_version: 1,
    })));
    await expect(duplicate.service.reconcile(context, source, productId, invoiceId))
      .rejects.toThrow("billing.iron_subscription_binding_ambiguous");

    const canceled = setup({}, [{
      tenant_id: gymId, external_id: ironSubscriptionId, status: "CANCELED", plan_code: "IRON_V1_MONTHLY", plan_version: 1,
    }]);
    await expect(canceled.service.reconcile(context, source, productId, invoiceId)).rejects.toThrow();
  });

  it("denies expired subscription or unauthorized Command viewer", async () => {
    const expired = setup({}, [{
      tenant_id: gymId, external_id: ironSubscriptionId, status: "ACTIVE",
      plan_code: "IRON_V1_MONTHLY", plan_version: 1, effective_until: "2020-01-01T00:00:00.000Z",
    }]);
    await expect(expired.service.reconcile(context, source, productId, invoiceId))
      .rejects.toThrow("billing.iron_subscription_expired");
    const viewer = setup();
    await expect(viewer.service.reconcile({ ...context, role: "viewer" }, source, productId, invoiceId))
      .rejects.toThrow("security.permission_denied:billing:write");
    expect(viewer.connector.subscriptionCommand).not.toHaveBeenCalled();
  });

  it("blocks an invoice predating its immutable plan mapping", async () => {
    const { connector, service } = setup({ invoiceCreatedAt: "2025-01-01T00:00:00.000Z" });
    await expect(service.reconcile(context, source, productId, invoiceId))
      .rejects.toThrow("billing.iron_mapping_not_effective_for_invoice");
    expect(connector.subscriptionCommand).not.toHaveBeenCalled();
  });

  it("blocks missing mapping or a mismatched canonical IRON version", async () => {
    const noMappingSource = { ...source, config: { baseUrl: "https://iron.example.test" } };
    const missing = setup();
    await expect(missing.service.reconcile(context, noMappingSource, productId, invoiceId))
      .rejects.toThrow("billing.iron_plan_mapping_unavailable");
    expect(missing.connector.subscriptionCommand).not.toHaveBeenCalled();

    const wrongVersion = setup({}, [{
      tenant_id: gymId, external_id: ironSubscriptionId, status: "ACTIVE",
      plan_code: "IRON_V1_MONTHLY", plan_version: 2,
    }]);
    await expect(wrongVersion.service.reconcile(context, source, productId, invoiceId))
      .rejects.toThrow("billing.iron_plan_mapping_unavailable");
    expect(wrongVersion.connector.subscriptionCommand).not.toHaveBeenCalled();
  });

  it("never trusts browser amount or webhook: route requires step-up and explicit disabled-by-default flag", async () => {
    const route = await readFile("src/app/api/billing/products/[productId]/iron-license/reconcile/route.ts", "utf8");
    const repository = await readFile("src/infrastructure/billing/postgres-paid-iron-invoice-repository.ts", "utf8");
    expect(route).toContain('FMCC_IRON_PAID_LICENSE_RECONCILIATION_ENABLED !== "YES"');
    expect(route).toContain("verifyPasswordStepUp");
    expect(route).toContain("requirePermission(context, \"billing:write\")");
    expect(route).not.toMatch(/input\.amountMinor|input\.externalTenantId|input\.paymentStatus|input\.gatewayAccountId/);
    for (const invariant of [
      'eq(billingInvoices.status, "paid")',
      'eq(billingProviderPayments.status, "received")',
      'eq(billingGatewayAccounts.environment, "production")',
      "eq(productDefinitions.slug, FMCC_IRON_PRODUCT_SLUG)",
      "eq(billingCustomerBindings.customerId, billingInvoices.customerId)",
      "eq(billingProductRoutes.gatewayAccountId, billingInvoices.gatewayAccountId)",
    ]) expect(repository).toContain(invariant);
  });
});
