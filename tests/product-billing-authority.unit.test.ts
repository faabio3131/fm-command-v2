import { describe, expect, it, vi } from "vitest";
import {
  BillingProductInputError,
  ProductBillingAuthorityService,
  type ProductBillingAuthorityRepository,
} from "../src/application/billing/product-billing-authority-service";
import type { TenantContext } from "../src/domain/security/tenant-context";

const owner: TenantContext = {
  tenantId: "fm",
  userId: "owner-1",
  role: "owner",
  correlationId: "corr-1",
};

function setup() {
  const repo: ProductBillingAuthorityRepository = {
    listPlans: vi.fn(async () => []),
    upsertPlan: vi.fn(async (_tenantId, productId, input) => ({
      id: "plan-1",
      productId,
      planCode: input.planCode,
      name: input.name,
      interval: input.interval,
      amountMinor: input.amountMinor,
      currency: "BRL" as const,
      status: input.status,
    })),
    getRoute: vi.fn(async (_tenantId, productId) => ({
      productId,
      gatewayAccountId: "11111111-1111-4111-8111-111111111111",
      provider: "asaas",
      environment: "production" as const,
      status: "enabled" as const,
    })),
    configureRoute: vi.fn(async (_tenantId, productId, gatewayAccountId) => ({
      productId,
      gatewayAccountId,
      provider: "asaas",
      environment: "production" as const,
      status: "enabled" as const,
    })),
    prepareSubscriptionInvoice: vi.fn(async (input) => ({
      productId: input.productId,
      externalTenantId: input.externalTenantId,
      customerId: "customer-1",
      subscriptionId: "subscription-1",
      invoiceId: "invoice-1",
      planCode: input.planCode,
      amountMinor: 26900,
      currency: "BRL" as const,
      gatewayAccountId: "11111111-1111-4111-8111-111111111111",
      gatewayProvider: "asaas",
      gatewayEnvironment: "production" as const,
      invoiceStatus: "pending",
      idempotentReplay: false,
    })),
  };
  return { repo, service: new ProductBillingAuthorityService(repo) };
}

describe("product-scoped central billing authority", () => {
  it("normalizes and persists FM-owned plan price instead of trusting a SaaS amount", async () => {
    const { repo, service } = setup();
    await service.upsertPlan(owner, "22222222-2222-4222-8222-222222222222", {
      planCode: "iron_v1_monthly",
      name: "IRON V1 Mensal",
      interval: "monthly",
      amountMinor: 26900,
    });
    expect(repo.upsertPlan).toHaveBeenCalledWith(
      "fm",
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        planCode: "IRON_V1_MONTHLY",
        amountMinor: 26900,
        status: "active",
      }),
    );
  });

  it("prepares invoice from product + external tenant + plan only and derives a stable payload hash", async () => {
    const { repo, service } = setup();
    await service.prepareSubscriptionInvoice(owner, "22222222-2222-4222-8222-222222222222", {
      externalTenantId: "iron-gym-123",
      planCode: "IRON_V1_MONTHLY",
      idempotencyKey: "iron:checkout:request-0001",
    });
    const call = vi.mocked(repo.prepareSubscriptionInvoice).mock.calls[0][0];
    expect(call).toMatchObject({
      tenantId: "fm",
      productId: "22222222-2222-4222-8222-222222222222",
      externalTenantId: "iron-gym-123",
      planCode: "IRON_V1_MONTHLY",
      idempotencyKey: "iron:checkout:request-0001",
    });
    expect(call.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call).not.toHaveProperty("amountMinor");
    expect(call).not.toHaveProperty("gatewayAccountId");
  });

  it("rejects malformed external tenant and idempotency authority", async () => {
    const { service } = setup();
    await expect(service.prepareSubscriptionInvoice(owner, "product", {
      externalTenantId: "../other-tenant",
      planCode: "IRON_V1_MONTHLY",
      idempotencyKey: "short",
    })).rejects.toBeInstanceOf(BillingProductInputError);
  });

  it("does not grant write access to a viewer", async () => {
    const { service } = setup();
    const viewer: TenantContext = { ...owner, role: "viewer" };
    await expect(service.upsertPlan(viewer, "product", {
      planCode: "IRON_V1_MONTHLY",
      name: "IRON",
      interval: "monthly",
      amountMinor: 26900,
    })).rejects.toThrow("security.permission_denied:billing:write");
  });
});
