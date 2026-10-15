import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  PostgresIronEntitlementOutbox,
  canonicalStateForEvent,
  outboxDedupeKey,
} from "@/infrastructure/billing/postgres-iron-entitlement-outbox";

const tenantId = "fm-control";
const productId = "368f552a-fb92-41bc-861e-e669e77d6f06";
const invoiceId = "a946c3cb-4c69-4ba9-bdfa-9f1f041a8384";
const subscriptionId = "44f0d246-d01a-439e-b21a-c0707098e147";
const id = "6e43f1bd-89fc-4791-aec9-26af97d1fd70";

function setup(state = { invoice_status: "paid", payment_status: "received", subscription_status: "active" }) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("SELECT i.id AS invoice_id")) {
        return { rowCount: 1, rows: [{
          invoice_id: invoiceId, subscription_id: subscriptionId, environment: "production", ...state,
        }] };
      }
      if (sql.includes("INSERT INTO fmcc_billing_iron_entitlement_outbox"))
        return { rowCount: 1, rows: [{ id }] };
      if (sql.includes("UPDATE fmcc_billing_iron_entitlement_outbox o SET"))
        return { rowCount: 1, rows: [{
          id, tenant_id: tenantId, product_id: productId,
          invoice_id: invoiceId, subscription_id: subscriptionId,
          event_type: "LICENSE_ACTIVATE", idempotency_key: outboxDedupeKey(invoiceId, subscriptionId, "LICENSE_ACTIVATE"),
          attempts: 1,
        }] };
      if (sql.includes("UPDATE fmcc_billing_iron_entitlement_outbox SET"))
        return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  return { outbox: new PostgresIronEntitlementOutbox(pool as never), queries, client, pool };
}

describe("D11 canonical IRON license outbox", () => {
  it("accepts only typed status transitions and deterministic invoice-level deduplication", () => {
    expect(canonicalStateForEvent("LICENSE_ACTIVATE")).toBe("active");
    expect(canonicalStateForEvent("LICENSE_SUSPEND")).toBe("past_due");
    expect(canonicalStateForEvent("LICENSE_CANCEL")).toBe("cancelled");
    expect(outboxDedupeKey(invoiceId, subscriptionId, "LICENSE_CANCEL"))
      .toContain(invoiceId + ":" + subscriptionId + ":LICENSE_CANCEL");
  });

  it("enqueues with locked canonical proof, immutable identity and transaction commit", async () => {
    const { outbox, queries, client } = setup();
    const result = await outbox.enqueue({ tenantId, productId, invoiceId, eventType: "LICENSE_ACTIVATE" });
    expect(result).toEqual({ id, inserted: true });
    expect(queries.map(q => q.sql)).toContain("BEGIN");
    expect(queries.map(q => q.sql)).toContain("COMMIT");
    expect(queries.find(q => q.sql.includes("SELECT i.id AS invoice_id"))?.sql).toContain("FOR UPDATE OF i, s");
    const inserted = queries.find(q => q.sql.includes("INSERT INTO fmcc_billing_iron_entitlement_outbox"));
    expect(inserted?.params).toEqual([
      tenantId, productId, invoiceId, subscriptionId, "LICENSE_ACTIVATE",
      outboxDedupeKey(invoiceId, subscriptionId, "LICENSE_ACTIVATE"),
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it.each([
    ["provider pending", { invoice_status: "paid", payment_status: "pending", subscription_status: "active" }, "LICENSE_ACTIVATE"],
    ["invoice pending", { invoice_status: "pending", payment_status: "received", subscription_status: "active" }, "LICENSE_ACTIVATE"],
    ["unverified cancellation", { invoice_status: "paid", payment_status: "received", subscription_status: "active" }, "LICENSE_CANCEL"],
    ["unverified suspension", { invoice_status: "paid", payment_status: "received", subscription_status: "active" }, "LICENSE_SUSPEND"],
  ] as const)("fails closed for %s before writing an event", async (_case, state, eventType) => {
    const { outbox, queries } = setup(state);
    await expect(outbox.enqueue({ tenantId, productId, invoiceId, eventType })).rejects.toThrow();
    expect(queries.some(q => q.sql.includes("INSERT INTO fmcc_billing_iron_entitlement_outbox"))).toBe(false);
    expect(queries.map(q => q.sql)).toContain("ROLLBACK");
  });

  it("rejects invalid tenant, product, invoice and event identifiers before opening a DB connection", async () => {
    const { outbox, pool } = setup();
    await expect(outbox.enqueue({ tenantId: "", productId, invoiceId, eventType: "LICENSE_ACTIVATE" })).rejects.toThrow();
    await expect(outbox.enqueue({ tenantId, productId: "wrong", invoiceId, eventType: "LICENSE_ACTIVATE" })).rejects.toThrow();
    await expect(outbox.enqueue({ tenantId, productId, invoiceId: "wrong", eventType: "LICENSE_ACTIVATE" })).rejects.toThrow();
    await expect(outbox.enqueue({ tenantId, productId, invoiceId, eventType: "UNSAFE" as never })).rejects.toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("uses fenced leases, bounded retries and a stable delivery key; never sends a provider request", async () => {
    const { outbox, queries } = setup();
    const claimed = await outbox.claim(tenantId, productId);
    expect(claimed).not.toBeNull();
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.claimToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(queries.find(q => q.sql.includes("FOR UPDATE SKIP LOCKED"))?.sql).toContain("attempts < 12");
    expect(await outbox.acknowledge(claimed!)).toBe(true);
    expect(await outbox.fail(claimed!, "TRANSIENT_UPSTREAM")).toBe(true);
    expect(queries.some(q => q.sql.includes("claim_token=$4 AND status='processing'"))).toBe(true);
    expect(queries.some(q => q.sql.includes("last_error_code=$6"))).toBe(true);
    await expect(outbox.fail(claimed!, "secret:must-not-log")).rejects.toThrow("billing.iron_outbox_error_code_invalid");
  });

  it("keeps migration and outbox certification wired into PostgreSQL gate", async () => {
    const workflow = await readFile(".github/workflows/billing-postgres-certification.yml","utf8");
    const schema = await readFile("src/infrastructure/db/billing-schema.ts","utf8");
    expect(schema).toContain('pgTable("fmcc_billing_iron_entitlement_outbox"');
    expect(schema).toContain("fmcc_iron_outbox_dedupe_uq");
    expect(workflow).toContain("iron-entitlement-outbox-pg-certification.mjs");
  });
});