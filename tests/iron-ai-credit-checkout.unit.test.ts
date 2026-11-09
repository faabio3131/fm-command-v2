import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/infrastructure/db/client", () => ({ pool: {} }));
import { CaktoPaymentProvider } from "@/infrastructure/subscription/cakto-payment-provider";
import { ironAiPack, IRON_AI_WORKOUT_PACKS } from "@/application/billing/iron-ai-credit-billing";

const ID = "fa9c7a11-5725-4495-bc16-f09a86c52d3e";
const secret = "test-only-credit-signature-secret-1234";
const now = new Date("2026-11-09T12:00:00.000Z");
const offers = [
  {offerId:"ai100",productId:"iron_ai",checkoutUrl:"https://pay.cakto.com.br/ai100",amountMinor:1990,interval:"one_time"},
  {offerId:"ai300",productId:"iron_ai",checkoutUrl:"https://pay.cakto.com.br/ai300",amountMinor:4990,interval:"one_time"},
  {offerId:"ai1000",productId:"iron_ai",checkoutUrl:"https://pay.cakto.com.br/ai1000",amountMinor:12990,interval:"one_time"},
  {offerId:"recurring",productId:"iron",checkoutUrl:"https://pay.cakto.com.br/iron",amountMinor:26900,interval:"month"},
];
const config = { FMCC_CAKTO_WEBHOOK_SECRET:secret, FMCC_CAKTO_CHECKOUTS_JSON:JSON.stringify(offers) };
const instance = () => new CaktoPaymentProvider(config, () => now);
const signed = (event: string, row: Record<string, unknown>) => {
  const raw = JSON.stringify({event,data:row});
  const ts = String(Math.floor(now.getTime()/1000));
  const sig = "v1=" + createHmac("sha256",secret).update(ts+"."+raw).digest("hex");
  return {raw,headers:new Headers({"x-cakto-timestamp":ts,"x-cakto-signature":sig})};
};
const payment = (offer = "ai100", value = 19.9) => ({
  id:"purchase_000001",offer_type:"main",sck:ID,status:"paid",amount:value,
  currency:"BRL",paidAt:now.toISOString(),offer:{id:offer},product:{id:"iron_ai"},
});

describe("IRON AI paid add-on contracts", () => {
  it("pins exactly three finite packs and safe prices; unknown and unlimited are denied",()=>{
    expect(Object.keys(IRON_AI_WORKOUT_PACKS)).toHaveLength(3);
    expect(ironAiPack("IRON_AI_WORKOUT_100")).toEqual({units:100,amountMinor:1990});
    expect(ironAiPack("IRON_AI_WORKOUT_300")).toEqual({units:300,amountMinor:4990});
    expect(ironAiPack("IRON_AI_WORKOUT_1000")).toEqual({units:1000,amountMinor:12990});
    expect(()=>ironAiPack("IRON_AI_UNLIMITED")).toThrow("iron.credits_package_invalid");
  });
  it("one-time checkout requires exact configured pack and can never use recurring offer",()=>{
    const p=instance();
    expect(p.oneTimeCheckout(ID,1990)).toBe("https://pay.cakto.com.br/ai100?sck="+ID);
    expect(()=>p.oneTimeCheckout(ID,26900)).toThrow("cakto.credits_offer_not_configured_or_ambiguous");
    expect(()=>p.oneTimeCheckout("attacker",1990)).toThrow("cakto.credits_reference_invalid");
    expect(()=>p.oneTimeCheckout(ID,0)).toThrow("cakto.credits_reference_invalid");
  });
  it("only signed main one-time purchase of exact amount and product can grant",()=>{
    const p=instance();
    const approved=signed("purchase_approved",payment());
    expect(p.verifyOneTimeWebhook(approved.headers,approved.raw)).toMatchObject({
      type:"payment_confirmed",subscriptionRef:ID,amount:{amountMinor:1990,currency:"BRL"}
    });
    expect(()=>p.verifyOneTimeWebhook(approved.headers,approved.raw+" ")).toThrow("webhook.signature_invalid");
    for(const row of [
      payment("ai300",19.9),payment("ai100",1),{...payment(),offer_type:"orderbump"},
      {...payment(),product:{id:"foreign"}}, {...payment(),sck:null},
      {...payment(),status:"awaiting_payment"},
    ]){
      const e=signed("purchase_approved",row);
      expect(p.verifyOneTimeWebhook(e.headers,e.raw)).toBeNull();
    }
    const recurring=signed("purchase_approved",{
      ...payment(),amount:269,offer:{id:"recurring"},product:{id:"iron"}
    });
    expect(p.verifyOneTimeWebhook(recurring.headers,recurring.raw)).toBeNull();
  });
  it("returns a distinguishable verified refund event; unsigned refunds cannot revoke",()=>{
    const p=instance();
    const refund=signed("refund",payment());
    expect(p.verifyOneTimeWebhook(refund.headers,refund.raw)).toMatchObject({type:"payment_refunded",subscriptionRef:ID});
    refund.headers.delete("x-cakto-signature");
    expect(()=>p.verifyOneTimeWebhook(refund.headers,refund.raw)).toThrow("webhook.signature_invalid");
  });
  it("rejects duplicate-price and unsafe hosted checkout configuration",()=>{
    expect(()=>new CaktoPaymentProvider({...config,FMCC_CAKTO_CHECKOUTS_JSON:JSON.stringify([
      ...offers,{...offers[0],offerId:"ai100_duplicate"}])})).not.toThrow();
    const duplicate=new CaktoPaymentProvider({...config,FMCC_CAKTO_CHECKOUTS_JSON:JSON.stringify([
      ...offers,{...offers[0],offerId:"ai100_duplicate"}])},()=>now);
    expect(()=>duplicate.oneTimeCheckout(ID,1990)).toThrow("cakto.credits_offer_not_configured_or_ambiguous");
    expect(()=>new CaktoPaymentProvider({...config,FMCC_CAKTO_CHECKOUTS_JSON:JSON.stringify([
      {...offers[0],checkoutUrl:"https://evil.example/pay"}])})).toThrow("cakto.checkout_config_invalid");
  });
});
