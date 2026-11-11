import { describe, expect, it, vi } from "vitest";
import {
  IronTrialPortfolioService,
  projectIronTrialSnapshot,
} from "@/application/customer/iron-trial-portfolio-service";
import type { TenantContext } from "@/domain/security/tenant-context";

const companyId = "fm-owner-company-1";
const productId = "994e4d76-fd48-4ee7-92fc-b3b4d87a5c11";
const gymA = "a87bd4a6-2c54-4eb3-a9e5-005a0b947e1b";
const gymB = "4ac6bd98-4a20-4c29-8ac5-b6213d46c8b4";
const subscriptionA = "d98ec5a2-2a31-4b63-82b8-7fbf10e11aa4";
const subscriptionB = "b3ef43ee-3fcf-49b1-882d-fb7cc7481d8f";
const token = "test-iron-command-s2s-" + "s".repeat(42);
const env = {
  FMCC_IRON_BILLING_TENANT_ID: companyId,
  FMCC_IRON_PRODUCT_ID: productId,
  FMCC_IRON_CONTROL_PLANE_URL: "https://api.ironfitcore.com.br/api/v1/control-plane/fmcc",
  FMCC_IRON_CONTROL_PLANE_TOKEN: token,
  FMCC_IRON_COMMERCIAL_SALES_ENABLED: "false",
};
const context: TenantContext = {
  tenantId: companyId,
  userId: "authorized-fm-user",
  role: "owner",
  correlationId: "test-iron-portfolio-01",
};

function snapshot() {
  return {
    schema_version: "iron.fmcc.commercial.v1",
    product_code: "IRON_FIT_CORE",
    as_of: "2026-11-11T01:20:00.000Z",
    customers: [
      { tenant_id: gymA, name: "Academia A", active: true, created_at: "2026-11-09T10:00:00.000Z" },
      { tenant_id: gymB, name: "Academia B", active: true, created_at: "2026-11-10T10:00:00.000Z" },
    ],
    trials: [
      { external_id: "request-a", tenant_id: gymA, subscription_id: subscriptionA,
        status: "active", started_at: "2026-11-09T10:00:00.000Z", ends_at: "2026-12-09T10:00:00.000Z" },
      { external_id: "request-b", tenant_id: gymB, subscription_id: subscriptionB,
        status: "expired", started_at: "2026-11-10T10:00:00.000Z", ends_at: "2026-12-10T10:00:00.000Z" },
    ],
    subscriptions: [
      { external_id: subscriptionA, tenant_id: gymA, status: "ACTIVE", plan_code: "IRON_V1_TRIAL" },
      { external_id: subscriptionB, tenant_id: gymB, status: "SUSPENDED", plan_code: "IRON_V1_TRIAL" },
    ],
    coverage: { tenant: "IRON_CANONICAL", trial: "IRON_CANONICAL" },
  };
}

function stubTransport(input: unknown, httpStatus = 200) {
  return vi.fn(async () => new Response(JSON.stringify(input), { status: httpStatus })) as unknown as typeof fetch;
}

describe("FM Command: IRON official trial customer portfolio", () => {
  it("reads every trial from the IRON source using the existing S2S boundary, with no Cakto dependency", async () => {
    const transport = stubTransport(snapshot());
    const actual = await new IronTrialPortfolioService(env, transport).read(context);
    expect(actual.status).toBe("ready");
    if (actual.status !== "ready") throw new Error("Expected source-backed records");
    expect(actual.total).toBe(2);
    expect(actual.sourceAuthority).toBe("IRON_CANONICAL");
    expect(actual.customers.map(c => c.gymName)).toEqual(["Academia B", "Academia A"]);
    expect(actual.customers.map(c => c.subscriptionStatus)).toEqual(["SUSPENDED", "ACTIVE"]);
    expect(actual.customers[0].gymId).toBe(gymB);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, request] = (transport as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.ironfitcore.com.br/api/v1/control-plane/fmcc/snapshot");
    expect(request.method).toBe("GET");
    expect(request.cache).toBe("no-store");
    expect(request.redirect).toBe("error");
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer " + token);
    expect(new Headers(request.headers).get("x-correlation-id")).toBeTruthy();
    expect(JSON.stringify(actual)).not.toContain("email");
    expect(JSON.stringify(actual)).not.toContain("cnpj");
  });

  it("never requests or exposes another FM tenant's IRON customers", async () => {
    const transport = stubTransport(snapshot());
    const actual = await new IronTrialPortfolioService(env, transport)
      .read({ ...context, tenantId: "another-fm-company" });
    expect(actual.status).toBe("not_applicable");
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not mix IRON trials into another selected product", async () => {
    const transport = stubTransport(snapshot());
    const actual = await new IronTrialPortfolioService(env, transport)
      .read(context, "e3d5337b-8340-4a3c-82c5-693ab4835b6f");
    expect(actual.status).toBe("not_applicable");
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not assume an empty portfolio when configuration or S2S connectivity fails", async () => {
    const withoutToken = new IronTrialPortfolioService({ ...env, FMCC_IRON_CONTROL_PLANE_TOKEN: "" }, stubTransport(snapshot()));
    expect(await withoutToken.read(context)).toEqual({ status: "unavailable" });
    const rejected = new IronTrialPortfolioService(env, stubTransport({ error: "unauthorized" }, 401));
    expect(await rejected.read(context)).toEqual({ status: "unavailable" });
  });

  it("rejects wrong source identity and orphan/cross-tenant trial subscriptions", async () => {
    const badSource = { ...snapshot(), product_code: "ANOTHER_PRODUCT" };
    expect(() => projectIronTrialSnapshot(badSource)).toThrow("iron.trial_snapshot_invalid");

    const crossTenant = snapshot();
    crossTenant.trials[0].subscription_id = subscriptionB;
    expect(() => projectIronTrialSnapshot(crossTenant)).toThrow("iron.trial_snapshot_invalid");
    const reader = new IronTrialPortfolioService(env, stubTransport(crossTenant));
    expect(await reader.read(context)).toEqual({ status: "unavailable" });
  });

  it("handles genuine zero trials, and never invents a customer or metric", async () => {
    const empty = { ...snapshot(), customers: [], subscriptions: [], trials: [] };
    const actual = await new IronTrialPortfolioService(env, stubTransport(empty)).read(context);
    expect(actual).toMatchObject({ status: "ready", total: 0, customers: [], truncated: false });
  });

  it("rejects invalid or duplicated trial requests and dates rather than silently dropping records", () => {
    const doubled = snapshot();
    doubled.trials[1].external_id = doubled.trials[0].external_id;
    expect(() => projectIronTrialSnapshot(doubled)).toThrow("iron.trial_snapshot_invalid");

    const invalid = snapshot();
    invalid.trials[0].ends_at = "2026-11-08T00:00:00.000Z";
    expect(() => projectIronTrialSnapshot(invalid)).toThrow("iron.trial_snapshot_invalid");
  });
});
