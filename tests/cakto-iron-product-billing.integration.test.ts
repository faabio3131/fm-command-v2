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
  const customer = await pool.query("INSERT INTO fmcc_billing_customer(tenant_id,external_customer_id) VALUES($1,$2) RETURNING id",
    [tenant, "ci-cakto-customer-"+randomUUID().slice(0,8)]);
  const customerId = customer.rows[0].id;
  const gateway = await pool.query("INSERT INTO fmcc_billing_gateway_account(tenant_id,provider,environment,label,secret_ref,status) VALUES($1,'cakto','production',$2,'env://FMCC_CAKTO_WEBHOOK_SECRET','enabled') RETURNING id",
    [tenant, "ci-"+randomUUID().slice(0,8)]);
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

  // Run the yearly delivery before the cancellation fixture leaves a deferred
  // monthly entitlement in the global outbox queue.
  dbIt("annual Cakto SKU pays a yearly invoice and activates ONLY the canonical IRON_START entitlement",async()=>{
    const annualGym=randomUUID();
    const annualIronSub=randomUUID();
    const newProduct=await pool.query(
      "INSERT INTO fmcc_product_definition(tenant_id,slug,name) VALUES($1,$2,'IRON ANNUAL CI') RETURNING id",
      [tenant,"annual-ci-"+randomUUID().slice(0,8)],
    );
    const annualProductId=newProduct.rows[0].id as string;
    const customer=await pool.query(
      "INSERT INTO fmcc_billing_customer(tenant_id,external_customer_id) VALUES($1,$2) RETURNING id",
      [tenant,"annual-ci-customer-"+randomUUID().slice(0,8)],
    );
    const customerId=customer.rows[0].id as string;
    const gateway=await pool.query(
      "INSERT INTO fmcc_billing_gateway_account(tenant_id,provider,environment,label,secret_ref,status) VALUES($1,'cakto','production',$2,'env://FMCC_CAKTO_WEBHOOK_SECRET','enabled') RETURNING id",
      [tenant,"annual-ci-"+randomUUID().slice(0,8)],
    );
    const accountId=gateway.rows[0].id as string;
    await pool.query(
      "INSERT INTO fmcc_billing_customer_binding(tenant_id,product_id,customer_id,external_tenant_id) VALUES($1,$2,$3,$4)",
      [tenant,annualProductId,customerId,annualGym],
    );
    await pool.query(
      "INSERT INTO fmcc_billing_product_plan(tenant_id,product_id,plan_code,name,interval,amount_minor,status) VALUES($1,$2,'IRON_START_Y_2026','IRON START ANNUAL','yearly',142800,'active')",
      [tenant,annualProductId],
    );
    const subscription=await pool.query(
      "INSERT INTO fmcc_billing_subscription(tenant_id,product_id,customer_id,plan_code,status) VALUES($1,$2,$3,'IRON_START_Y_2026','pending') RETURNING id",
      [tenant,annualProductId,customerId],
    );
    const annualSubscriptionId=subscription.rows[0].id as string;
    const invoice=await pool.query(
      "INSERT INTO fmcc_billing_invoice(tenant_id,product_id,customer_id,subscription_id,gateway_account_id,amount_minor,status) VALUES($1,$2,$3,$4,$5,142800,'pending') RETURNING id",
      [tenant,annualProductId,customerId,annualSubscriptionId,accountId],
    );
    const annualInvoiceId=invoice.rows[0].id as string;
    const billing=new CaktoIronProductBilling({
      FMCC_IRON_BILLING_TENANT_ID:tenant,FMCC_IRON_PRODUCT_ID:annualProductId,
      FMCC_IRON_COMMERCIAL_SALES_ENABLED:"true",FMCC_CAKTO_WEBHOOK_SECRET:secret,
      FMCC_CAKTO_CHECKOUTS_JSON:JSON.stringify([{
        offerId:"annual_ci_offer",productId:"annual_iron_product",
        checkoutUrl:"https://pay.cakto.com.br/annual_ci_offer",
        amountMinor:142800,interval:"year",
      }]),
    });
    expect(await billing.checkoutUrl(annualInvoiceId)).toContain("sck="+annualInvoiceId);
    const orderId="annual_purchase_"+randomUUID().slice(0,8);
    const body=JSON.stringify({
      event:"purchase_approved",data:{
        id:orderId,offer_type:"main",sck:annualInvoiceId,
        status:"paid",amount:1428,currency:"BRL",paidAt:new Date().toISOString(),
        offer:{id:"annual_ci_offer"},product:{id:"annual_iron_product"},
      },
    });
    const timestamp=String(Math.floor(Date.now()/1000));
    const signature="v1="+createHmac("sha256",secret).update(timestamp+"."+body).digest("hex");
    const headers=new Headers({"x-cakto-timestamp":timestamp,"x-cakto-signature":signature});
    expect(await billing.handleWebhook(headers,body)).toBe("applied");
    expect(await billing.handleWebhook(headers,body)).toBe("duplicate");
    const paid=await pool.query(
      "SELECT i.status AS invoice_status,i.period_end,s.plan_code,s.paid_through FROM fmcc_billing_invoice i JOIN fmcc_billing_subscription s ON s.id=i.subscription_id WHERE i.id=$1",
      [annualInvoiceId],
    );
    expect(paid.rows[0].invoice_status).toBe("paid");
    expect(paid.rows[0].plan_code).toBe("IRON_START_Y_2026");
    expect(paid.rows[0].paid_through.getTime()-Date.now()).toBeGreaterThan(300*86_400_000);
    expect(paid.rows[0].paid_through.getTime()).toBe(paid.rows[0].period_end.getTime());
    const called:Array<{url:string;init:RequestInit}>=[];
    const mockFetch=(async(url:string|URL|Request,init:RequestInit={})=>{
      called.push({url:String(url),init});
      if(String(url).endsWith("/snapshot"))return new Response(JSON.stringify({
        subscriptions:[{tenant_id:annualGym,plan_code:"IRON_START",
          external_id:annualIronSub,status:"ACTIVE"}],
      }),{status:200});
      return new Response(JSON.stringify({result:{entitlementStatus:"ACTIVE"}}),{status:201});
    }) as typeof fetch;
    const worker=new IronEntitlementOutboxWorker(pool,{
      FMCC_IRON_CONTROL_PLANE_URL:"https://api.ironfitcore.com.br/api/v1/control-plane/fmcc",
      FMCC_IRON_CONTROL_PLANE_TOKEN:"annual-ci-only-"+"t".repeat(40),
    },mockFetch);
    expect(await worker.processOne()).toBe("delivered");
    const commands=called.filter(x=>x.init.method==="POST")
      .map(x=>JSON.parse(x.init.body as string) as Record<string,unknown>);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      action:"subscription.status.sync",gymId:annualGym,
      expectedSubscriptionId:annualIronSub,entitlementStatus:"ACTIVE",
      paidThrough:paid.rows[0].paid_through.toISOString(),
    });
    expect(commands[0]).not.toHaveProperty("planCode");
    const outbox=await pool.query(
      "SELECT status FROM fmcc_billing_iron_entitlement_outbox WHERE tenant_id=$1 AND invoice_id=$2",
      [tenant,annualInvoiceId],
    );
    expect(outbox.rows).toEqual([{status:"delivered"}]);
  },90_000);

  dbIt("cancellation never bills another cycle and preserves paid access until end of term",async()=>{
    const {subscriptionId}=await prepare();
    const cfg={
      FMCC_IRON_BILLING_TENANT_ID:tenant, FMCC_IRON_PRODUCT_ID:productId,
      FMCC_IRON_COMMERCIAL_SALES_ENABLED:"true",
      FMCC_CAKTO_WEBHOOK_SECRET:secret,
      FMCC_CAKTO_CHECKOUTS_JSON:JSON.stringify([
        {offerId:"offer_month",productId:"iron_product",
          checkoutUrl:"https://pay.cakto.com.br/offer_month",amountMinor:26900,interval:"month"},
      ]),
    };
    const billing=new CaktoIronProductBilling(cfg);
    const initial=notification("purchase_approved","order_cancella_"+randomUUID().slice(0,8),"paid");
    expect(await billing.handleWebhook(initial.headers,initial.raw)).toBe("applied");
    const paid=await pool.query("SELECT paid_through FROM fmcc_billing_subscription WHERE id=$1",[subscriptionId]);
    const paidThrough=paid.rows[0].paid_through as Date;
    // A SKU may be retired/repriced after a valid payment. That must never
    // prevent a signed cancellation/refund from reconciling the old invoice.
    await pool.query(
      "UPDATE fmcc_billing_product_plan SET status='inactive',amount_minor=27900 WHERE tenant_id=$1 AND product_id=$2",
      [tenant,productId],
    );
    const cancellation=notification("subscription_canceled","order_cancel_"+randomUUID().slice(0,8),"cancelled");
    expect(await billing.handleWebhook(cancellation.headers,cancellation.raw)).toBe("applied");
    expect(await billing.handleWebhook(cancellation.headers,cancellation.raw)).toBe("duplicate");
    const after=await pool.query("SELECT status,paid_through FROM fmcc_billing_subscription WHERE id=$1",[subscriptionId]);
    expect(after.rows[0].status).toBe("cancelled");
    expect((after.rows[0].paid_through as Date).getTime()).toBe(paidThrough.getTime());
    const rows=await pool.query(
      "SELECT event_type,status,available_at FROM fmcc_billing_iron_entitlement_outbox WHERE tenant_id=$1 AND subscription_id=$2 ORDER BY created_at",
      [tenant,subscriptionId],
    );
    expect(rows.rows.filter((r:{event_type:string})=>r.event_type==="LICENSE_CANCEL")).toHaveLength(1);
    const future=rows.rows.find((r:{event_type:string})=>r.event_type==="LICENSE_CANCEL");
    expect((future.available_at as Date).getTime()).toBeGreaterThanOrEqual(paidThrough.getTime());
    const renewed=notification("subscription_renewed","order_after_cancel_"+randomUUID().slice(0,8),"paid");
    await expect(billing.handleWebhook(renewed.headers,renewed.raw))
      .rejects.toThrow("cakto.cancelled_subscription_cannot_reactivate");
    const count=await pool.query("SELECT count(*)::int AS n FROM fmcc_billing_invoice WHERE tenant_id=$1 AND subscription_id=$2",[tenant,subscriptionId]);
    expect(count.rows[0].n).toBe(1);
  }, 90_000);



});
