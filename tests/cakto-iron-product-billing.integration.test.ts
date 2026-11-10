import { createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/infrastructure/db/client";
import { CaktoIronProductBilling } from "@/application/billing/cakto-iron-product-billing";
import { IronEntitlementOutboxWorker } from "@/application/billing/iron-entitlement-outbox-worker";

const enabled = process.env.FMCC_CAKTO_DB_CERTIFICATION === "1" && process.env.DATABASE_URL?.includes("fmcc_billing_ci");
const dbIt = enabled ? it : it.skip;
const tenant = "ci-cakto-" + randomUUID().slice(0, 12);
const gym = randomUUID();
const ironSubscription = randomUUID();
const secret = "ci-cakto-only-" + "x".repeat(40);
const order1 = "order_initial_" + randomUUID().slice(0, 8);
const order2 = "order_renewed_" + randomUUID().slice(0, 8);
let productId = "";
let invoiceId = "";

async function prepare() {
  const product = await pool.query("INSERT INTO fmcc_product_definition(tenant_id,slug,name) VALUES ($1,$2,'IRON CI') RETURNING id", [tenant, "iron-ci-"+randomUUID().slice(0, 8)]);
  productId = product.rows[0].id;
  const customer = await pool.query("INSERT INTO fmcc_billing_customer(tenant_id,external_customer_id) VALUES($1,'ci-cakto-customer') RETURNING id", [tenant]);
  const customerId = customer.rows[0].id;
  const gateway = await pool.query("INSERT INTO fmcc_billing_gateway_account(tenant_id,provider,environment,label,secret_ref,status) VALUES($1,'cakto','production','ci','env://FMCC_CAKTO_WEBHOOK_SECRET','enabled') RETURNING id", [tenant]);
  const accountId = gateway.rows[0].id;
  await pool.query("INSERT INTO fmcc_billing_customer_binding(tenant_id,product_id,customer_id,external_tenant_id) VALUES($1,$2,$3,$4)", [tenant, productId, customerId, gym]);
  await pool.query("INSERT INTO fmcc_billing_product_plan(tenant_id,product_id,plan_code,name,interval,amount_minor,status) VALUES($1,$2,'IRON_PRO','Iron PRO','monthly',26900,'active')", [tenant, productId]);
  const sub = await pool.query("INSERT INTO fmcc_billing_subscription(tenant_id,product_id,customer_id,plan_code,status) VALUES($1,$2,$3,'IRON_PRO','pending') RETURNING id", [tenant, productId, customerId]);
  const inv = await pool.query("INSERT INTO fmcc_billing_invoice(tenant_id,product_id,customer_id,subscription_id,gateway_account_id,amount_minor,status) VALUES($1,$2,$3,$4,$5,26900,'pending') RETURNING id", [tenant, productId, customerId, sub.rows[0].id, accountId]);
  invoiceId = inv.rows[0].id;
  return { accountId, subscriptionId: sub.rows[0].id };
}

function notification(event: string, orderId: string, status: string, amount = 269) {
  const body = JSON.stringify({
    event, data: { id: orderId, offer_type: "main", sck: invoiceId, status, amount,
      currency: "BRL", paidAt: new Date().toISOString(),
      offer: { id: "offer_month" }, product: { id: "iron_product" } },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = "v1=" + createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
  return { raw: body, headers: new Headers({ "x-cakto-timestamp": timestamp, "x-cakto-signature": signature }) };
}

afterAll(async () => {
  if (!enabled) return;
  await pool.query("DELETE FROM fmcc_billing_iron_entitlement_outbox WHERE tenant_id=$1", [tenant]);
  await pool.query("DELETE FROM fmcc_billing_gateway_event WHERE tenant_id=$1", [tenant]);
  await pool.query("DELETE FROM fmcc_billing_provider_payment WHERE tenant_id=$1", [tenant]);
  await pool.query("DELETE FROM fmcc_billing_invoice WHERE tenant_id=$1", [tenant]);
  await pool.query("DELETE FROM fmcc_billing_subscription WHERE tenant_id=$1", [tenant]);
  await pool.query("DELETE FROM fmcc_billing_product_plan WHERE tenant_id=$1", [tenant]);
  await pool.query("DELETE FROM fmcc_billing_customer_binding WHERE tenant_id=$1", [tenant]);
  await pool.query("DELETE FROM fmcc_billing_gateway_account WHERE tenant_id=$1", [tenant]);
  await pool.query("DELETE FROM fmcc_billing_customer WHERE tenant_id=$1", [tenant]);
  await pool.query("DELETE FROM fmcc_product_definition WHERE tenant_id=$1", [tenant]);
});

describe("Cakto -> canonical IRON billing -> durable S2S (disposable PostgreSQL 18)", () => {
  dbIt("confirms first payment, records recurring cycle, isolates old refund, and suspends refunded current cycle", async () => {
    const { subscriptionId } = await prepare();
    const cfg = {
      FMCC_IRON_COMMERCIAL_SALES_ENABLED: "true",
      FMCC_IRON_BILLING_TENANT_ID: tenant, FMCC_IRON_PRODUCT_ID: productId,
      FMCC_CAKTO_WEBHOOK_SECRET: secret,
      FMCC_CAKTO_CHECKOUTS_JSON: JSON.stringify([
        { offerId: "offer_month", productId: "iron_product", checkoutUrl: "https://pay.cakto.com.br/offer_month", amountMinor: 26900, interval: "month" },
      ]),
    };
    const restricted = new CaktoIronProductBilling({ ...cfg, FMCC_IRON_COMMERCIAL_SALES_ENABLED: "false" });
    await expect(restricted.checkoutUrl(invoiceId)).rejects.toThrow("cakto.iron_sales_not_authorized");
    const billing = new CaktoIronProductBilling(cfg);
    const checkout = await billing.checkoutUrl(invoiceId);
    expect(checkout).toContain("sck="+invoiceId);

    const first = notification("purchase_approved", order1, "paid");
    expect(await billing.handleWebhook(first.headers, first.raw)).toBe("applied");
    expect(await billing.handleWebhook(first.headers, first.raw)).toBe("duplicate");
    const state1 = await pool.query("SELECT status,paid_through FROM fmcc_billing_subscription WHERE id=$1", [subscriptionId]);
    expect(state1.rows[0].status).toBe("active");
    expect(state1.rows[0].paid_through).toBeInstanceOf(Date);
    const bill1 = await pool.query("SELECT status,period_end FROM fmcc_billing_invoice WHERE id=$1", [invoiceId]);
    expect(bill1.rows[0].status).toBe("paid");
    expect(bill1.rows[0].period_end.getTime()).toBe(state1.rows[0].paid_through.getTime());

    const called: Array<{ url: string; init: RequestInit }> = [];
    const mockFetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
      called.push({ url: String(url), init });
      if (String(url).endsWith("/snapshot")) return new Response(JSON.stringify({
        subscriptions: [{ tenant_id: gym, plan_code: "IRON_PRO", external_id: ironSubscription, status: "ACTIVE" }],
      }), { status: 200 });
      return new Response(JSON.stringify({ result: { entitlementStatus: "ACTIVE" } }), { status: 201 });
    }) as typeof fetch;
    const worker = new IronEntitlementOutboxWorker(pool, {
      FMCC_IRON_CONTROL_PLANE_URL: "https://api.ironfitcore.com.br/api/v1/control-plane/fmcc",
      FMCC_IRON_CONTROL_PLANE_TOKEN: "ci-only-" + "t".repeat(40),
    }, mockFetch);
    expect(await worker.processOne()).toBe("delivered");
    const activation = called.find(x => x.init.method === "POST");
    expect(activation).toBeDefined();
    expect(JSON.parse(activation!.init.body as string)).toMatchObject({
      gymId: gym, expectedSubscriptionId: ironSubscription, entitlementStatus: "ACTIVE",
      paidThrough: state1.rows[0].paid_through.toISOString(),
    });

    const renewal = notification("subscription_renewed", order2, "paid");
    expect(await billing.handleWebhook(renewal.headers, renewal.raw)).toBe("applied");
    expect(await billing.handleWebhook(renewal.headers, renewal.raw)).toBe("duplicate");
    const state2 = await pool.query("SELECT status,paid_through FROM fmcc_billing_subscription WHERE id=$1", [subscriptionId]);
    expect(state2.rows[0].paid_through.getTime()).toBeGreaterThan(state1.rows[0].paid_through.getTime());
    const paidCycles = await pool.query("SELECT id,period_end FROM fmcc_billing_invoice WHERE tenant_id=$1 AND subscription_id=$2 AND status='paid'", [tenant, subscriptionId]);
    expect(paidCycles.rowCount).toBe(2);
    expect(await worker.processOne()).toBe("delivered");

    const oldRefund = notification("refund", order1, "refunded");
    expect(await billing.handleWebhook(oldRefund.headers, oldRefund.raw)).toBe("applied");
    const stillActive = await pool.query("SELECT status FROM fmcc_billing_subscription WHERE id=$1", [subscriptionId]);
    expect(stillActive.rows[0].status).toBe("active");
    const queueBefore = await pool.query("SELECT count(*)::int AS n FROM fmcc_billing_iron_entitlement_outbox WHERE tenant_id=$1 AND event_type='LICENSE_SUSPEND'", [tenant]);
    expect(queueBefore.rows[0].n).toBe(0);

    const currentRefund = notification("chargeback", order2, "refunded");
    expect(await billing.handleWebhook(currentRefund.headers, currentRefund.raw)).toBe("applied");
    const suspended = await pool.query("SELECT status FROM fmcc_billing_subscription WHERE id=$1", [subscriptionId]);
    expect(suspended.rows[0].status).toBe("past_due");
    expect(await worker.processOne()).toBe("delivered");
    expect(called.some(x => x.init.method === "POST" && JSON.parse(x.init.body as string).entitlementStatus === "SUSPENDED")).toBe(true);

    const tampered = notification("purchase_approved", "order_forged", "paid");
    await expect(billing.handleWebhook(tampered.headers, tampered.raw.replace('"amount":269', '"amount":1'))).rejects.toThrow("webhook.signature_invalid");
  }, 90_000);
});
