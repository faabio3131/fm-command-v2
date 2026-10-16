import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { GovernedIronOutboxDispatcher } from "@/application/billing/governed-iron-outbox-dispatcher";
import type { SourceDefinition } from "@/domain/integration/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";
import type { IronCommercialConnector } from "@/infrastructure/integration/iron-commercial-connector";
import type { PostgresIronEntitlementOutbox, IronOutboxItem } from "@/infrastructure/billing/postgres-iron-entitlement-outbox";

const gymId = "8042dfb0-80db-49de-86b1-011c27e7bb5d";
const subscriptionId = "8100c575-3d49-4e75-8342-7ef8b1006c24";
const productId = "17e5992d-d9c5-4541-b2df-5a0d4bef8c0f";
const invoiceId = "4f14ea86-f343-4e99-9280-56966b582ae1";
const itemId = "fc9c4c7e-b2d2-416f-92b8-e43ded58c045";
const context: TenantContext = {
  tenantId: "fm-owned", userId: "owner-user", role: "owner", correlationId: "corr-one",
};
const source: SourceDefinition = {
  id: "source-iron", name: "IRON FIT CORE Commercial",
  tenantId: context.tenantId, productId,
  sourceType: "iron-commercial-v1", authoritativeDomain: "commercial",
  secretRef: "env:FMCC_IRON_CONTROL_PLANE_TOKEN",
  status: "configured", syncMode: "pull", mappingVersion: "iron-commercial-v1",
  freshnessSeconds: 300,
  config: {
    baseUrl: "https://iron.example.test",
    ironCommercialPlanMappings: {
      schemaVersion: "iron.commercial-plan-mappings.v1",
      mappings: [{
        revision: 1, commercialPlanCode: "IRON_MONTHLY",
        ironPlanCode: "IRON_PRO", ironPlanVersion: 4,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      }],
    },
  },
};
const item: IronOutboxItem = {
  id: itemId, tenantId: context.tenantId, productId, invoiceId,
  subscriptionId, eventType: "LICENSE_ACTIVATE",
  idempotencyKey: "iron:entitlement:v1:" + invoiceId + ":" + subscriptionId + ":LICENSE_ACTIVATE",
  attempts: 1, claimToken: "93f9c920-0924-4059-ac35-51c63cd17d21",
};

function setup(overrides: {
  event?: IronOutboxItem["eventType"];
  authority?: boolean;
  billingStatus?: string;
  snapshotStatus?: string;
  responseGymId?: string;
  providerFailure?: boolean;
  wrongVersion?: boolean;
} = {}) {
  const claimed: IronOutboxItem = { ...item, eventType: overrides.event ?? item.eventType };
  const proof = overrides.authority === false ? null : {
    externalTenantId: gymId, planCode: "IRON_MONTHLY",
    subscriptionStatus: overrides.billingStatus ??
      (claimed.eventType === "LICENSE_ACTIVATE" ? "active" : claimed.eventType === "LICENSE_SUSPEND" ? "past_due" : "cancelled"),
    invoiceStatus: "paid", paymentStatus: "received",
  };
  const snapshotRow = {
    external_id: subscriptionId, tenant_id: gymId,
    plan_code: "IRON_PRO", plan_version: overrides.wrongVersion ? 2 : 4,
    status: overrides.snapshotStatus ?? "ACTIVE",
    effective_until: null,
  };
  const repository = {
    claim: vi.fn(async () => claimed),
    authority: vi.fn(async () => proof),
    acknowledge: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
  const connector = {
    snapshot: vi.fn(async () => ({
      schema_version: "iron.fmcc.commercial.v1", product_code: "IRON_FIT_CORE",
      as_of: new Date().toISOString(),
      customers: [], trials: [], subscriptions: [snapshotRow], entitlements: [],
      onboarding: [], billing_transactions: [], summary: {}, facts: [],
      coverage: { subscription_projection: "IRON_CANONICAL" },
    })),
    subscriptionCommand: vi.fn(async (_ctx: unknown, _source: unknown, command: { entitlementStatus: string }, _idempotencyKey: string) => {
      if (overrides.providerFailure) throw new Error("network unavailable");
      return { idempotent: false, result: {
        tenantId: overrides.responseGymId ?? gymId, subscriptionId,
        entitlementStatus: command.entitlementStatus,
        planCode: "IRON_PRO", planVersion: 4,
      } };
    }),
  };
  const dispatcher = new GovernedIronOutboxDispatcher(
    repository as unknown as Pick<PostgresIronEntitlementOutbox, "claim" | "authority" | "acknowledge" | "fail">,
    connector as unknown as Pick<IronCommercialConnector, "snapshot" | "subscriptionCommand">,
  );
  return { dispatcher, repository, connector };
}

describe("D11 governed delivery of a claimed IRON entitlement event", () => {
  it("revalidates canonical billing and maps activation to IRON control-plane status sync", async () => {
    const { dispatcher, repository, connector } = setup();
    const result = await dispatcher.processOne(context, source, productId);
    expect(result).toMatchObject({ status: "delivered", gymId, entitlementStatus: "ACTIVE", mappingRevision: 1 });
    expect(repository.authority).toHaveBeenCalledWith(expect.objectContaining({ id: itemId }));
    expect(connector.subscriptionCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: context.tenantId }), source,
      expect.objectContaining({
        action: "subscription.status.sync", gymId,
        expectedSubscriptionId: subscriptionId, entitlementStatus: "ACTIVE",
        commercialStatus: "active",
      }),
      "fmcc:iron:outbox:v1:" + itemId,
    );
    expect(repository.acknowledge).toHaveBeenCalledTimes(1);
  });

  it("maps verified cancellation and delinquency without re-enabling an older license", async () => {
    for (const [event, expected] of [
      ["LICENSE_CANCEL", "CANCELED"], ["LICENSE_SUSPEND", "SUSPENDED"],
    ] as const) {
      const { dispatcher, connector } = setup({ event });
      const result = await dispatcher.processOne(context, source, productId);
      expect(result).toMatchObject({ status: "delivered", entitlementStatus: expected });
      expect(connector.subscriptionCommand).toHaveBeenCalledWith(
        expect.anything(), source, expect.objectContaining({ entitlementStatus: expected }), expect.any(String),
      );
    }
  });

  it("fails closed if billing state was reversed after the event was queued", async () => {
    const { dispatcher, repository, connector } = setup({ authority: false });
    const result = await dispatcher.processOne(context, source, productId);
    expect(result.status).toBe("blocked");
    expect(repository.fail).toHaveBeenCalledWith(expect.anything(), "IRON_OUTBOX_CANONICAL_STATE_CHANGED", true);
    expect(connector.snapshot).not.toHaveBeenCalled();
    expect(connector.subscriptionCommand).not.toHaveBeenCalled();
  });

  it("blocks mismatched IRON versions and prohibits resurrection of a canceled subscription", async () => {
    const mismatch = setup({ wrongVersion: true });
    expect((await mismatch.dispatcher.processOne(context, source, productId)).status).toBe("blocked");
    expect(mismatch.connector.subscriptionCommand).not.toHaveBeenCalled();

    const canceled = setup({ snapshotStatus: "CANCELED" });
    expect((await canceled.dispatcher.processOne(context, source, productId)).status).toBe("blocked");
    expect(canceled.connector.subscriptionCommand).not.toHaveBeenCalled();
  });

  it("retries temporary network failures with exactly the same idempotency key", async () => {
    const { dispatcher, repository, connector } = setup({ providerFailure: true });
    const result = await dispatcher.processOne(context, source, productId);
    expect(result.status).toBe("retry");
    expect(repository.fail).toHaveBeenCalledWith(expect.anything(), "IRON_OUTBOX_DELIVERY_RETRYABLE", false);
    expect(repository.acknowledge).not.toHaveBeenCalled();
    expect(connector.subscriptionCommand.mock.calls[0][3]).toBe("fmcc:iron:outbox:v1:" + itemId);
  });

  it("blocks malformed success responses and stale tenant bindings", async () => {
    const wrongTenant = setup({ responseGymId: "other-gym" });
    const result = await wrongTenant.dispatcher.processOne(context, source, productId);
    expect(result.status).toBe("blocked");
    expect(wrongTenant.repository.acknowledge).not.toHaveBeenCalled();
  });

  it("denies unauthorized roles and cross-tenant source before claiming", async () => {
    const { dispatcher, repository } = setup();
    await expect(dispatcher.processOne({ ...context, role: "viewer" }, source, productId))
      .rejects.toThrow("security.permission_denied:billing:write");
    await expect(dispatcher.processOne(context, { ...source, tenantId: "other" }, productId)).rejects.toThrow();
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("keeps endpoint disabled by default and requires a real owner's password step-up", async () => {
    const route = await readFile("src/app/api/billing/products/[productId]/iron-license/outbox/route.ts","utf8");
    const repo = await readFile("src/infrastructure/billing/postgres-iron-entitlement-outbox.ts","utf8");
    expect(route).toContain('FMCC_IRON_OUTBOX_MANUAL_OPERATIONS_ENABLED !== "YES"');
    expect(route).toContain('FMCC_IRON_OUTBOX_DELIVERY_ENABLED !== "YES"');
    expect(route).toContain('FMCC_IRON_PAID_LICENSE_RECONCILIATION_ENABLED !== "YES"');
    expect(route).toContain("verifyPasswordStepUp");
    expect(route).toContain("requirePermission(context, \"billing:write\")");
    expect(route).toContain("environmentIronControlTenantId()");
    expect(repo).toContain("o.claim_token=$5");
    expect(repo).toContain("AND o.lease_until>now()");
    expect(repo).toContain("$4 <> 'LICENSE_ACTIVATE'");
  });
});
