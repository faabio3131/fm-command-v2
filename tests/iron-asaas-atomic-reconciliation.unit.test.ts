import { describe, expect, it, vi, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import {
  AsaasIronPaymentReadOnlyClient,
  ironAsaasInvoiceReference,
} from "@/infrastructure/billing/asaas-iron-payment-readonly-client";
import { PostgresIronAsaasAtomicReconciliation } from "@/infrastructure/billing/postgres-iron-asaas-atomic-reconciliation";
import type { TenantContext } from "@/domain/security/tenant-context";

const tenantId = "ci-command";
const productId = "7b24b69b-b82e-4933-94b0-60dd6044c4e1";
const invoiceId = "e1a91bf0-97cc-4d76-b4a1-fc1e7b398621";
const subscriptionId = "b8351d51-c606-4339-b304-07e401410524";
const gatewayAccountId = "0c3ecdbf-7235-45af-b8e5-d25e9dc85e65";
const paymentId = "pay_ci_iron_123";
const customerId = "cus_ci_iron_456";
const amountMinor = 1990;
const context: TenantContext = { tenantId, userId: "operator", role: "owner", correlationId: "corr-1" };
const binding = { tenantId, productId, invoiceId, subscriptionId, gatewayAccountId, paymentId, customerId, amountMinor };
const providerData = {
  id: paymentId, customer: customerId, externalReference: ironAsaasInvoiceReference(invoiceId),
  value: 19.90, billingType: "PIX", status: "RECEIVED",
};

afterEach(() => vi.unstubAllEnvs());

describe("D11 Asaas read-only commercial payment proof", () => {
  it("fetches just the recorded provider payment, authenticates and validates every binding field", async () => {
    vi.stubEnv("FMCC_ASAAS_PRODUCTION_API_KEY", "ci-only-secret-not-real");
    const mockFetch = vi.fn(async () => new Response(JSON.stringify(providerData), { status: 200 }));
    const verified = await new AsaasIronPaymentReadOnlyClient(mockFetch as typeof fetch).verify({
      paymentId, invoiceId, customerId, amountMinor,
    });
    expect(verified).toEqual({
      id: paymentId, customer: customerId,
      externalReference: providerData.externalReference, valueMinor: amountMinor,
      billingType: "PIX", status: "RECEIVED",
    });
    const [url, options] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.asaas.com/v3/payments/" + paymentId);
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
    expect((options.headers as Record<string, string>).access_token).toBe("ci-only-secret-not-real");
    expect(options.redirect).toBe("error");
  });

  it.each([
    ["wrong customer", { customer: "cus_other" }],
    ["wrong payment ID", { id: "pay_other" }],
    ["wrong invoice reference", { externalReference: "fmcc-kordena-real-pix-001" }],
    ["wrong value", { value: 20.00 }],
    ["card data mismatch", { billingType: "UNSUPPORTED" }],
  ])("rejects %s before any billing write", async (_name, change) => {
    vi.stubEnv("FMCC_ASAAS_PRODUCTION_API_KEY", "ci-only-secret-not-real");
    const data = { ...providerData, ...change };
    const client = new AsaasIronPaymentReadOnlyClient(vi.fn(async () =>
      new Response(JSON.stringify(data), { status: 200 })) as typeof fetch);
    await expect(client.verify({ paymentId, invoiceId, customerId, amountMinor }))
      .rejects.toThrow("billing.iron_asaas_payment_mismatch");
  });

  it.each(["CONFIRMED", "PENDING", "PARTIALLY_REFUNDED", "CHARGEBACK_REQUESTED", "OVERDUE"])(
    "does not treat %s as a certified payment or refund", async status => {
      vi.stubEnv("FMCC_ASAAS_PRODUCTION_API_KEY", "ci-only-secret-not-real");
      const client = new AsaasIronPaymentReadOnlyClient(vi.fn(async () =>
        new Response(JSON.stringify({ ...providerData, status }), { status: 200 })) as typeof fetch);
      await expect(client.verify({ paymentId, invoiceId, customerId, amountMinor }))
        .rejects.toThrow("billing.iron_asaas_state_requires_review");
    });

  it("handles full verified refund, upstream rejection and timeout without write", async () => {
    vi.stubEnv("FMCC_ASAAS_PRODUCTION_API_KEY", "ci-only-secret-not-real");
    const refund = new AsaasIronPaymentReadOnlyClient(vi.fn(async () =>
      new Response(JSON.stringify({ ...providerData, status: "REFUNDED" }), { status: 200 })) as typeof fetch);
    expect((await refund.verify({ paymentId, invoiceId, customerId, amountMinor })).status).toBe("REFUNDED");
    const rejection = new AsaasIronPaymentReadOnlyClient(vi.fn(async () => new Response(null, { status: 403 })) as typeof fetch);
    await expect(rejection.verify({ paymentId, invoiceId, customerId, amountMinor }))
      .rejects.toThrow("billing.iron_asaas_http_403");
    const failure = new AsaasIronPaymentReadOnlyClient(vi.fn(async () => { throw new Error("network"); }) as typeof fetch);
    await expect(failure.verify({ paymentId, invoiceId, customerId, amountMinor }))
      .rejects.toThrow("billing.iron_asaas_get_unavailable");
  });

  it("blocks invalid provider IDs before sending any GET", async () => {
    vi.stubEnv("FMCC_ASAAS_PRODUCTION_API_KEY", "ci-only-secret-not-real");
    const mock = vi.fn();
    const client = new AsaasIronPaymentReadOnlyClient(mock as typeof fetch);
    await expect(client.verify({ paymentId: "/../other", invoiceId, customerId, amountMinor })).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
});

function transactionMock(input: {
  invoiceStatus?: string; paymentStatus?: string; subscriptionStatus?: string;
  missingSource?: boolean; failInsert?: boolean; existingEvent?: boolean;
} = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("SELECT i.subscription_id,p.external_payment_id")) return {
      rowCount: 1, rows: [{
        subscription_id: subscriptionId, external_payment_id: paymentId,
        external_customer_id: customerId, amount_minor: String(amountMinor),
        invoice_status: input.invoiceStatus ?? "payment_pending",
        payment_status: input.paymentStatus ?? "pending",
        subscription_status: input.subscriptionStatus ?? "pending",
        plan_code: "IRON_MONTHLY", created_at: new Date("2026-10-12T15:00:00Z"),
        gateway_status: "enabled", route_status: "enabled",
      }],
    };
    if (sql.includes("SELECT config FROM fmcc_source_definition")) return {
      rowCount: input.missingSource ? 0 : 1,
      rows: input.missingSource ? [] : [{ config: {
        ironCommercialPlanMappings: {
          schemaVersion: "iron.commercial-plan-mappings.v1",
          mappings: [{
            revision: 1, commercialPlanCode: "IRON_MONTHLY",
            ironPlanCode: "IRON_PRO", ironPlanVersion: 4,
            effectiveFrom: "2026-10-12T12:00:00.000Z",
          }],
        },
      } }],
    };
    if (sql.includes("INSERT INTO fmcc_billing_iron_entitlement_outbox")) {
      if (input.failInsert) throw new Error("db.insert.failed");
      return { rowCount: input.existingEvent ? 0 : 1, rows: input.existingEvent ? [] : [{ id: "event-id" }] };
    }
    if (sql.includes("SELECT id FROM fmcc_billing_iron_entitlement_outbox"))
      return { rowCount: 1, rows: [{ id: "event-id" }] };
    return { rowCount: 1, rows: [] };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) };
  const repository = new PostgresIronAsaasAtomicReconciliation(pool as never);
  return { repository, calls, release };
}

describe("D11 atomic financial state and outbox in one transaction", () => {
  it("marks fully received payment, invoice and subscription and persists exactly one license activation", async () => {
    const { repository, calls, release } = transactionMock();
    const result = await repository.commitVerified(context, binding, {
      id: paymentId, customer: customerId, valueMinor: amountMinor,
      externalReference: ironAsaasInvoiceReference(invoiceId), billingType: "PIX", status: "RECEIVED",
    });
    expect(result).toEqual({ invoiceId, eventId: "event-id", eventType: "LICENSE_ACTIVATE", inserted: true });
    expect(calls.map(c => c.sql)).toContain("BEGIN");
    expect(calls.map(c => c.sql)).toContain("COMMIT");
    expect(calls.some(c => c.sql.includes("SET status='received'"))).toBe(true);
    expect(calls.some(c => c.sql.includes("SET status='paid'"))).toBe(true);
    expect(calls.some(c => c.sql.includes("SET status='active'"))).toBe(true);
    expect(calls.some(c => c.sql.includes("INSERT INTO fmcc_billing_iron_entitlement_outbox"))).toBe(true);
    expect(calls.some(c => c.sql.includes("INSERT INTO fmcc_billing_audit_event"))).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it("full refund suspends license while retaining commercial history", async () => {
    const { repository, calls } = transactionMock({
      invoiceStatus: "paid", paymentStatus: "received", subscriptionStatus: "active",
    });
    const result = await repository.commitVerified(context, binding, {
      id: paymentId, customer: customerId, valueMinor: amountMinor,
      externalReference: ironAsaasInvoiceReference(invoiceId), billingType: "PIX", status: "REFUNDED",
    });
    expect(result.eventType).toBe("LICENSE_SUSPEND");
    expect(calls.some(c => c.sql.includes("SET status='refunded'"))).toBe(true);
    expect(calls.some(c => c.sql.includes("SET status='past_due'"))).toBe(true);
    expect(calls.some(c => c.sql.includes("'LICENSE_CANCEL'"))).toBe(false);
  });

  it("is idempotent for payment replay without a second outbox event", async () => {
    const { repository } = transactionMock({
      invoiceStatus: "paid", paymentStatus: "received", subscriptionStatus: "active", existingEvent: true,
    });
    const result = await repository.commitVerified(context, binding, {
      id: paymentId, customer: customerId, valueMinor: amountMinor,
      externalReference: ironAsaasInvoiceReference(invoiceId), billingType: "PIX", status: "RECEIVED",
    });
    expect(result).toMatchObject({ eventId: "event-id", inserted: false });
  });

  it("rejects stale positive state after refund and rolls back all writes", async () => {
    const { repository, calls } = transactionMock({
      invoiceStatus: "refunded", paymentStatus: "refunded", subscriptionStatus: "past_due",
    });
    await expect(repository.commitVerified(context, binding, {
      id: paymentId, customer: customerId, valueMinor: amountMinor,
      externalReference: ironAsaasInvoiceReference(invoiceId), billingType: "PIX", status: "RECEIVED",
    })).rejects.toThrow("billing.iron_asaas_paid_after_reversal_denied");
    expect(calls.map(c => c.sql)).toContain("ROLLBACK");
    expect(calls.map(c => c.sql)).not.toContain("COMMIT");
  });

  it("never commits paid financial state if enqueue fails", async () => {
    const { repository, calls } = transactionMock({ failInsert: true });
    await expect(repository.commitVerified(context, binding, {
      id: paymentId, customer: customerId, valueMinor: amountMinor,
      externalReference: ironAsaasInvoiceReference(invoiceId), billingType: "PIX", status: "RECEIVED",
    })).rejects.toThrow("db.insert.failed");
    expect(calls.map(c => c.sql)).toContain("ROLLBACK");
    expect(calls.map(c => c.sql)).not.toContain("COMMIT");
  });

  it("rejects missing source or mismatched actor tenant without financial changes", async () => {
    const missing = transactionMock({ missingSource: true });
    await expect(missing.repository.commitVerified(context, binding, {
      id: paymentId, customer: customerId, valueMinor: amountMinor,
      externalReference: ironAsaasInvoiceReference(invoiceId), billingType: "PIX", status: "RECEIVED",
    })).rejects.toThrow("billing.iron_asaas_source_not_canonical");
    const wrong = transactionMock();
    await expect(wrong.repository.commitVerified({ ...context, tenantId: "wrong" }, binding, {
      id: paymentId, customer: customerId, valueMinor: amountMinor,
      externalReference: ironAsaasInvoiceReference(invoiceId), billingType: "PIX", status: "RECEIVED",
    })).rejects.toThrow("billing.iron_asaas_scope_mismatch");
    expect(wrong.calls).toHaveLength(0);
  });

  it("requires protected API, manual feature flag and password step-up", async () => {
    const route = await readFile("src/app/api/billing/products/[productId]/iron-license/asaas-reconcile/route.ts", "utf8");
    expect(route).toContain('FMCC_IRON_ASAAS_ATOMIC_RECONCILIATION_ENABLED !== "YES"');
    expect(route).toContain("verifyPasswordStepUp");
    expect(route).toContain('requirePermission(context, "billing:write")');
    expect(route).toContain("environmentIronControlTenantId()");
  });
});
