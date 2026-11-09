import { describe, expect, it } from "vitest";
import { IronEntitlementOutboxWorker, ironLicenseCommand, selectIronSubscription } from "@/application/billing/iron-entitlement-outbox-worker";
import type { Pool } from "pg";

const gym = "d29f0dd5-0f3b-4c46-93b5-b5c18f53a073";
const ironSubscription = "0592a749-ab6c-4cbc-94d9-bdc5fca927b0";
const invoice = "33804d46-6da3-4273-803f-cefcf73b74d4";
const outbox = "98c06e68-96ba-46c0-9e75-2eaecf613f24";
const token = "test-only-control-plane-abcdefghijklmnopqrstuvwxyz";
const env = { FMCC_IRON_CONTROL_PLANE_URL: "https://api.ironfitcore.com.br/api/v1/control-plane/fmcc", FMCC_IRON_CONTROL_PLANE_TOKEN: token };

describe("IRON canonical entitlement delivery contract", () => {
  it("selects only a unique scoped current IRON subscription", () => {
    const snapshot = { subscriptions: [
      { tenant_id: gym, plan_code: "IRON_PRO", external_id: ironSubscription, status: "ACTIVE" },
      { tenant_id: "cd81ebaa-260d-437b-b489-a2fbfb8bd305", plan_code: "IRON_PRO", external_id: "92dac5f8-596a-4a26-9689-c37ad091984f", status: "ACTIVE" },
    ] };
    expect(selectIronSubscription(snapshot, gym, "IRON_PRO")).toBe(ironSubscription);
    expect(() => selectIronSubscription(snapshot, gym, "IRON_OTHER")).toThrow("iron.subscription_not_unique_or_missing");
    expect(() => selectIronSubscription({ subscriptions: [...snapshot.subscriptions, snapshot.subscriptions[0]] }, gym, "IRON_PRO")).toThrow("iron.subscription_not_unique_or_missing");
    expect(() => selectIronSubscription({ subscriptions: [] }, gym, "IRON_PRO")).toThrow();
    expect(() => selectIronSubscription({ subscriptions: snapshot.subscriptions }, "not-a-uuid", "IRON_PRO")).toThrow();
  });

  it("never grants extra authority: uses canonical status sync and existing subscription ID", () => {
    expect(ironLicenseCommand("LICENSE_ACTIVATE", gym, ironSubscription, invoice)).toMatchObject({
      action: "subscription.status.sync", gymId: gym, expectedSubscriptionId: ironSubscription,
      commercialStatus: "active", entitlementStatus: "ACTIVE",
    });
    expect(ironLicenseCommand("LICENSE_SUSPEND", gym, ironSubscription, invoice).entitlementStatus).toBe("SUSPENDED");
    expect(ironLicenseCommand("LICENSE_CANCEL", gym, ironSubscription, invoice).entitlementStatus).toBe("CANCELED");
  });

  it("delivers an outbox claim exactly once, with signed S2S bearer and stable idempotency key", async () => {
    const sqls: string[] = [];
    const pool = { query: async (sql: string, _params?: unknown[]) => {
      sqls.push(sql);
      if (sql.includes("RETURNING id, tenant_id")) return { rows: [{ id: outbox, tenant_id: "fm-tenant", product_id: "iron-product", invoice_id: invoice, subscription_id: "billing-sub", event_type: "LICENSE_ACTIVATE", attempts: 1, claim_token: "lease" }] };
      if (sql.includes("SELECT b.external_tenant_id")) return { rows: [{ gym_id: gym, plan_code: "IRON_PRO", invoice_status: "paid", subscription_status: "active" }] };
      return { rows: [], rowCount: 1 };
    }} as unknown as Pick<Pool, "query">;
    const http: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      http.push({ url: String(url), init });
      if (String(url).endsWith("/snapshot")) return new Response(JSON.stringify({
        subscriptions: [{ tenant_id: gym, plan_code: "IRON_PRO", external_id: ironSubscription, status: "ACTIVE" }],
      }), { status: 200 });
      return new Response(JSON.stringify({ result: { status: "ACTIVE" } }), { status: 200 });
    }) as typeof fetch;
    const result = await new IronEntitlementOutboxWorker(pool, env, mockFetch).processOne();
    expect(result).toBe("delivered");
    expect(http).toHaveLength(2);
    const posted = http[1].init!;
    expect(posted.method).toBe("POST");
    expect(JSON.parse(posted.body as string)).toMatchObject({ gymId: gym, expectedSubscriptionId: ironSubscription, entitlementStatus: "ACTIVE" });
    const h = new Headers(posted.headers);
    expect(h.get("idempotency-key")).toBe("fmcc-cakto-license-" + outbox);
    expect(h.get("authorization")).toBe("Bearer " + token);
    expect(sqls.some(x => x.includes("status='delivered'"))).toBe(true);
  });

  it("retains a retryable DB job on transient S2S failure, without marking it delivered", async () => {
    const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const pool = { query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("RETURNING id, tenant_id")) return { rows: [{ id: outbox, tenant_id: "fm-tenant", product_id: "iron-product", invoice_id: invoice, subscription_id: "billing-sub", event_type: "LICENSE_ACTIVATE", attempts: 1, claim_token: "lease" }] };
      if (sql.includes("SELECT b.external_tenant_id")) return { rows: [{ gym_id: gym, plan_code: "IRON_PRO", invoice_status: "paid", subscription_status: "active" }] };
      return { rows: [], rowCount: 1 };
    }} as unknown as Pick<Pool, "query">;
    const failingFetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
    expect(await new IronEntitlementOutboxWorker(pool, env, failingFetch).processOne()).toBe("retry");
    expect(queries.some(x => x.params?.includes("retry"))).toBe(true);
    expect(queries.some(x => x.sql.includes("status='delivered'"))).toBe(false);
  });

  it("does not deliver a license for unpaid or missing canonical invoice binding", async () => {
    const pool = { query: async (sql: string, _params?: unknown[]) => {
      if (sql.includes("RETURNING id, tenant_id")) return { rows: [{ id: outbox, tenant_id: "fm-tenant", product_id: "iron-product", invoice_id: invoice, subscription_id: "billing-sub", event_type: "LICENSE_ACTIVATE", attempts: 1, claim_token: "lease" }] };
      if (sql.includes("SELECT b.external_tenant_id")) return { rows: [{ gym_id: gym, plan_code: "IRON_PRO", invoice_status: "pending", subscription_status: "pending" }] };
      return { rows: [], rowCount: 1 };
    }} as unknown as Pick<Pool, "query">;
    let called = false;
    const mockFetch = (async () => { called = true; throw new Error("network_should_not_be_used"); }) as typeof fetch;
    expect(await new IronEntitlementOutboxWorker(pool, env, mockFetch).processOne()).toBe("blocked");
    expect(called).toBe(false);
  });
});
