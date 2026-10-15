import { describe, expect, it, vi } from "vitest";
import {
  IRON_COMMERCIAL_SECRET_REF,
  IRON_COMMERCIAL_SOURCE_TYPE,
  IronCommercialConnector,
} from "@/infrastructure/integration/iron-commercial-connector";

const source = {
  id: "source-iron",
  tenantId: "fm-tenant",
  productId: "product-iron",
  name: "IRON FIT CORE Commercial",
  sourceType: IRON_COMMERCIAL_SOURCE_TYPE,
  authoritativeDomain: "commercial",
  status: "configured" as const,
  syncMode: "pull" as const,
  secretRef: IRON_COMMERCIAL_SECRET_REF,
  config: { baseUrl: "https://iron.example.test" },
  freshnessSeconds: 300,
  mappingVersion: "iron-commercial-v1",
};

const context = {
  tenantId: "fm-tenant",
  correlationId: "corr-iron-1",
  timeoutMs: 5000,
};

describe("IRON commercial connector", () => {
  it("pulls canonical facts through the governed snapshot", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      schema_version: "iron.fmcc.commercial.v1",
      product_code: "IRON_FIT_CORE",
      as_of: "2026-10-12T00:00:00.000Z",
      customers: [],
      trials: [],
      subscriptions: [],
      entitlements: [],
      onboarding: [],
      billing_transactions: [],
      summary: { customers: 0, active_subscriptions: 0 },
      facts: [{
        external_id: "tenant:gym-1",
        fact_type: "iron.tenant",
        payload: { tenant_id: "gym-1" },
        source_timestamp: "2026-10-12T00:00:00.000Z",
      }],
      coverage: { billing_transactions: "FM_COMMAND_AUTHORITY" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const connector = new IronCommercialConnector(
      () => "x".repeat(40),
      fetcher as typeof fetch,
      () => ["https://iron.example.test"],
      () => "fm-tenant",
    );

    const result = await connector.pull(context, source);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.factType).toBe("iron.tenant");
    expect(fetcher).toHaveBeenCalledWith(
      "https://iron.example.test/api/v1/control-plane/fmcc/snapshot",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const calls = fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const headers = calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer " + "x".repeat(40));
    expect(headers.get("x-correlation-id")).toBe("corr-iron-1");
  });

  it("fails closed for a different control tenant or origin", async () => {
    const connector = new IronCommercialConnector(
      () => "x".repeat(40),
      vi.fn() as unknown as typeof fetch,
      () => ["https://other.example.test"],
      () => "fm-tenant",
    );
    await expect(connector.health({ ...context, tenantId: "other" }, source)).resolves.toBe("unavailable");
    await expect(connector.snapshot(context, source)).rejects.toThrow("integration.iron_origin_not_allowed");
  });

  it("sends license commands with idempotency and no gateway authority", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      idempotent: false,
      result: { entitlementStatus: "ACTIVE" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const connector = new IronCommercialConnector(
      () => "x".repeat(40),
      fetcher as typeof fetch,
      () => ["https://iron.example.test"],
      () => "fm-tenant",
    );

    await connector.subscriptionCommand(context, source, {
      action: "subscription.status.sync",
      gymId: "gym-1",
      expectedSubscriptionId: "sub-1",
      commercialStatus: "active",
      entitlementStatus: "ACTIVE",
      reason: "payment-confirmed",
    }, "invoice-1:payment-1");

    const calls = fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const request = calls[0]?.[1];
    const headers = request?.headers as Headers;
    expect(headers.get("idempotency-key")).toBe("invoice-1:payment-1");
    expect(String(request?.body)).not.toContain("gatewayAccountId");
  });

  it("never forwards IRON service credentials to a Kordena or foreign-tenant source", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const connector = new IronCommercialConnector(
      () => "iron-only-secret-of-fm-technology-123456",
      fetcher as typeof fetch,
      () => ["https://iron.example.test"],
      () => "fm-tenant",
    );
    for (const malformed of [
      { ...source, tenantId: "another-tenant" },
      { ...source, sourceType: "kordena-commercial-v1" },
      { ...source, secretRef: "env:FMCC_KORDENA_CONTROL_PLANE_TOKEN" },
      { ...source, authoritativeDomain: "student-finance" },
      { ...source, productId: undefined },
    ]) {
      await expect(connector.snapshot(context, malformed)).rejects.toThrow(
        "integration.iron_source_scope_denied",
      );
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

});
