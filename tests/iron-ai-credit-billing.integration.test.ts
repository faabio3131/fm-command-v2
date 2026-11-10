import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookRejectedError } from "@/domain/subscription/payment-provider";

const store = vi.hoisted(() => ({
  orders: new Map<string, Record<string, unknown>>(),
  events: [] as Array<Record<string, unknown>>,
  deliveries: [] as Array<Record<string, unknown>>,
  commits: 0, rollbacks: 0, invalidScope: false,
}));
vi.mock("@/infrastructure/db/client", () => ({
  pool: {
    connect: async () => ({
      release: () => {},
      query: async (sql: string, values: unknown[] = []) => {
        const q = sql.trim().replace(/\s+/g," ").toLowerCase();
        if (q === "begin") return {rows:[],rowCount:0};
        if (q === "commit") {store.commits++;return {rows:[],rowCount:0};}
        if (q === "rollback") {store.rollbacks++;return {rows:[],rowCount:0};}
        if (q.includes("pg_advisory_xact_lock")) return {rows:[],rowCount:1};
        if (q.includes("select * from fmcc_iron_ai_credit_order") && q.includes("idempotency_key")) {
          const found=[...store.orders.values()].filter(row=>row.gym_id===values[2] && row.idempotency_key===values[3]);
          return {rows:found,rowCount:found.length};
        }
        if (q.includes("select b.customer_id") && q.includes("fmcc_billing_customer_binding")) {
          const rows=store.invalidScope ? [] : [{
            customer_id:"1e9e9632-c0c3-4621-9a9a-8b89e2cf159a",
            subscription_id:"21baebf9-f3eb-4be9-a03d-cf08ac1cc1e4",
            gateway_account_id:"7214de90-fac7-4b63-94e6-b0c10a288828",
          }];
          return {rows,rowCount:rows.length};
        }
        if (q.includes("insert into fmcc_iron_ai_credit_order")) {
          const row={id:values[0],tenant_id:values[1],product_id:values[2],gym_id:values[3],
            customer_id:values[4],subscription_id:values[5],gateway_account_id:values[6],
            package_code:values[7],units:values[8],amount_minor:values[9],idempotency_key:values[10],
            status:"pending",payment_ref:null};
          store.orders.set(String(values[0]),row);
          return {rows:[row],rowCount:1};
        }
        if (q.includes("select * from fmcc_iron_ai_credit_order") && q.includes("for update")) {
          const value=store.orders.get(String(values[0]));
          const rows=value && value.tenant_id===values[1] && value.product_id===values[2] ? [value] : [];
          return {rows,rowCount:rows.length};
        }
        if (q.includes("insert into fmcc_iron_ai_credit_provider_event")) {
          store.events.push({invoice:values[0],payment:values[1],type:values[2],fingerprint:values[3]});
          return {rows:[],rowCount:1};
        }
        if (q.includes("update fmcc_iron_ai_credit_order")) {
          const row=store.orders.get(String(values[0]));
          if(!row) return {rows:[],rowCount:0};
          row.status=values[1];row.payment_ref=values[2];
          return {rows:[],rowCount:1};
        }
        if (q.includes("insert into fmcc_iron_ai_credit_outbox")) {
          store.deliveries.push({invoice:values[0],type:values[1]});
          return {rows:[],rowCount:1};
        }
        throw new Error("Unexpected SQL: "+q.slice(0,100));
      },
    }),
  },
}));
import { IronAiCreditBilling } from "@/application/billing/iron-ai-credit-billing";

const tenant="fmcc-iron";
const product="ab046dd7-626a-4296-9af0-c44144bb8d65";
const gym="00d4727a-03d4-4d5a-915f-b2a3e45f6dc0";
const secret="test-credit-webhook-private-secret-123456";
const env={
  FMCC_IRON_COMMERCIAL_SALES_ENABLED:"true",
  FMCC_IRON_BILLING_TENANT_ID:tenant,
  FMCC_IRON_PRODUCT_ID:product,
  FMCC_CAKTO_WEBHOOK_SECRET:secret,
  FMCC_CAKTO_CHECKOUTS_JSON:JSON.stringify([
    {offerId:"iron_ai100",productId:"iron_ai",checkoutUrl:"https://pay.cakto.com.br/ai100",
      amountMinor:1990,interval:"one_time"},
  ]),
};
function signed(invoice: string, type: "purchase_approved" | "refund" | "chargeback", changes: Record<string,unknown>={}) {
  const raw=JSON.stringify({event:type,data:{
    id:"purchase_credit_0001",offer_type:"main",sck:invoice,status:type==="purchase_approved"?"paid":"refunded",
    amount:19.9,currency:"BRL",offer:{id:"iron_ai100"},product:{id:"iron_ai"},
    paidAt:new Date().toISOString(),...changes,
  }});
  const ts=String(Math.floor(Date.now()/1000));
  return {raw,headers:new Headers({"x-cakto-timestamp":ts,"x-cakto-signature":
    "v1="+createHmac("sha256",secret).update(ts+"."+raw).digest("hex")})};
}
beforeEach(()=>{
  store.orders.clear();store.events.length=0;store.deliveries.length=0;
  store.commits=0;store.rollbacks=0;store.invalidScope=false;
});
describe("IRON credit purchase commercial ledger and signed settlement",()=>{
  it("never issues a new checkout before explicit commercial go-live",async()=>{
    const {FMCC_IRON_COMMERCIAL_SALES_ENABLED: _sales, ...restricted}=env;
    const app=new IronAiCreditBilling(restricted);
    await expect(app.prepareCheckout(gym,"IRON_AI_WORKOUT_100","blocked-request-0001"))
      .rejects.toThrow("iron.credits_sales_not_authorized");
    expect(store.orders.size).toBe(0);
    const invalid=new IronAiCreditBilling({...env,FMCC_IRON_COMMERCIAL_SALES_ENABLED:"false"});
    await expect(invalid.prepareCheckout(gym,"IRON_AI_WORKOUT_100","blocked-request-0002"))
      .rejects.toThrow("iron.credits_sales_not_authorized");
  });
  it("prepares one bound order and replays same idempotency without new invoice",async()=>{
    const app=new IronAiCreditBilling(env);
    const a=await app.prepareCheckout(gym,"IRON_AI_WORKOUT_100","same-request-000001");
    expect(a).toMatchObject({amountMinor:1990,units:100,status:"pending",idempotent:false});
    expect(a.checkoutUrl).toBe("https://pay.cakto.com.br/ai100?sck="+a.invoiceId);
    const b=await app.prepareCheckout(gym,"IRON_AI_WORKOUT_100","same-request-000001");
    expect(b).toMatchObject({invoiceId:a.invoiceId,idempotent:true});
    expect(store.orders.size).toBe(1);
    await expect(app.prepareCheckout(gym,"IRON_AI_WORKOUT_300","same-request-000001"))
      .rejects.toThrow("cakto.credits_offer_not_configured_or_ambiguous");
  });
  it("fails closed without active and uniquely bound paid subscription",async()=>{
    store.invalidScope=true;
    await expect(new IronAiCreditBilling(env).prepareCheckout(gym,"IRON_AI_WORKOUT_100","attempt-00001"))
      .rejects.toThrow("iron.credits_subscription_not_active_or_ambiguous");
    expect(store.orders.size).toBe(0);
    expect(store.rollbacks).toBe(1);
  });
  it("only signed exact-price PAID checkout grants, duplicate event has zero extra effects",async()=>{
    const app=new IronAiCreditBilling(env);
    const order=await app.prepareCheckout(gym,"IRON_AI_WORKOUT_100","attempt-00002");
    const receipt=signed(order.invoiceId,"purchase_approved");
    expect(await app.handleWebhook(receipt.headers,receipt.raw)).toBe("applied");
    expect(store.orders.get(order.invoiceId)?.status).toBe("paid");
    expect(store.deliveries).toEqual([{invoice:order.invoiceId,type:"GRANT"}]);
    expect(await app.handleWebhook(receipt.headers,receipt.raw)).toBe("duplicate");
    expect(store.deliveries).toHaveLength(1);
  });
  it("wrong amount, unknown invoice and invalid signature never issue credits",async()=>{
    const app=new IronAiCreditBilling(env);
    const order=await app.prepareCheckout(gym,"IRON_AI_WORKOUT_100","attempt-00003");
    const altered=signed(order.invoiceId,"purchase_approved",{amount:1});
    expect(await app.handleWebhook(altered.headers,altered.raw)).toBe("ignored");
    const foreign=signed("328ec91f-e575-45e6-83db-9956a3b4e5ff","purchase_approved");
    expect(await app.handleWebhook(foreign.headers,foreign.raw)).toBe("unmatched");
    const forged=signed(order.invoiceId,"purchase_approved");
    forged.headers.set("x-cakto-signature","v1"+"0".repeat(64));
    await expect(app.handleWebhook(forged.headers,forged.raw)).rejects.toBeInstanceOf(WebhookRejectedError);
    expect(store.deliveries).toHaveLength(0);
  });
  it("refund requires the exact original payment and queues one compensating revocation",async()=>{
    const app=new IronAiCreditBilling(env);
    const order=await app.prepareCheckout(gym,"IRON_AI_WORKOUT_100","attempt-00004");
    const pay=signed(order.invoiceId,"purchase_approved");
    await app.handleWebhook(pay.headers,pay.raw);
    const wrong=signed(order.invoiceId,"refund",{id:"other_credit_0009"});
    expect(await app.handleWebhook(wrong.headers,wrong.raw)).toBe("ignored");
    const refund=signed(order.invoiceId,"refund");
    expect(await app.handleWebhook(refund.headers,refund.raw)).toBe("applied");
    expect(await app.handleWebhook(refund.headers,refund.raw)).toBe("duplicate");
    expect(store.deliveries).toEqual([
      {invoice:order.invoiceId,type:"GRANT"},{invoice:order.invoiceId,type:"REVOKE"}
    ]);
    expect(store.orders.get(order.invoiceId)?.status).toBe("refunded");
    expect(await app.handleWebhook(pay.headers,pay.raw)).toBe("ignored");
  });
});
