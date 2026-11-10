import { describe, expect, it } from "vitest";
import { IronCommerceProvisioning, verifyIronCommerceBearer } from "@/application/billing/iron-commerce-provisioning";

const gym="d29f0dd5-0f3b-4c46-93b5-b5c18f53a073";
const sub="0592a749-ab6c-4cbc-94d9-bdc5fca927b0";
const product="33804d46-6da3-4273-803f-cefcf73b74d4";
const invoice="98c06e68-96ba-46c0-9e75-2eaecf613f24";
const token="test-private-iron-commerce-token-"+"q".repeat(45);
const env={
  FMCC_IRON_PRODUCT_ID: product, FMCC_IRON_BILLING_TENANT_ID:"fm-ci-tenant",
  FMCC_IRON_CONTROL_PLANE_URL:"https://api.ironfitcore.com.br/api/v1/control-plane/fmcc",
  FMCC_IRON_CONTROL_PLANE_TOKEN:token,
  FMCC_IRON_COMMERCIAL_SALES_ENABLED:"true",
  FMCC_CAKTO_WEBHOOK_SECRET: "ci-webhook-"+ "a".repeat(35),
  FMCC_CAKTO_CHECKOUTS_JSON:JSON.stringify([{offerId:"offer_ci",productId:"product_ci",
    checkoutUrl:"https://pay.cakto.com.br/offer_ci",amountMinor:26900,interval:"month"}]),
};
const req={gymId:gym,expectedSubscriptionId:sub,planCode:"IRON_PRO",idempotencyKey:"iron-ct-test-ref-01"};
type TestPlan = {planCode:string; name:string; interval:"monthly"|"yearly"; amountMinor:number; status:"active"|"inactive"};
function create(overrides: {
  snapshot?:unknown; plans?:unknown; billingPlans?:TestPlan[];
  env?:Record<string,string|undefined>;
  onPrepare?:(x:Record<string,unknown>)=>Promise<unknown>|unknown;
} = {}) {
  const provider={
    listPlans: async () => overrides.billingPlans ?? [{
      planCode:"IRON_PRO", name:"Pro", interval:"monthly" as const,
      amountMinor:26900, status:"active" as const,
    }],
    getRoute: async () => ({status:"enabled",provider:"cakto",environment:"production"}),
    prepareSubscriptionInvoice: async (x: Record<string,unknown>)=> {
      if (overrides.onPrepare) return overrides.onPrepare(x);
      expect(x.externalTenantId).toBe(gym);expect(x.planCode).toBe("IRON_PRO");
      return { invoiceId:invoice,gatewayProvider:"cakto",gatewayEnvironment:"production" };
    },
  };
  const transport=(async (url: string | URL | Request,init?:RequestInit)=>{
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer "+token);
    if (String(url).endsWith("/snapshot")) return new Response(JSON.stringify(overrides.snapshot ?? {
      subscriptions:[{tenant_id:gym,external_id:sub,status:"ACTIVE"}]
    }),{status:200});
    return new Response(JSON.stringify(overrides.plans ?? {plans:[{plan_code:"IRON_PRO",version:1}]}),{status:200});
  }) as typeof fetch;
  return new IronCommerceProvisioning({...env,...overrides.env},transport,provider as never);
}
describe("IRON commerce S2S purchase boundary",()=>{
  it("refuses invalid machine bearer",()=>{
    expect(verifyIronCommerceBearer("Bearer "+token,token)).toBe(true);
    expect(verifyIronCommerceBearer("Bearer "+token+"x",token)).toBe(false);
    expect(verifyIronCommerceBearer(null,token)).toBe(false);
    expect(verifyIronCommerceBearer("Bearer "+token,"")).toBe(false);
  });
  it("refuses forged/foreign/expired current IRON subscriptions before writing invoice",async()=>{
    await expect(create({snapshot:{subscriptions:[{tenant_id:"other",external_id:sub,status:"ACTIVE"}]}})
      .prepare(req)).rejects.toThrow("iron.commerce_subscription_invalid");
    await expect(create({snapshot:{subscriptions:[{tenant_id:gym,external_id:sub,status:"SUSPENDED"}]}})
      .prepare(req)).rejects.toThrow("iron.commerce_subscription_invalid");
    await expect(create({plans:{plans:[{plan_code:"IRON_OTHER",version:1}]}})
      .prepare(req)).rejects.toThrow("iron.commerce_plan_not_published");
    await expect(create().prepare({...req,gymId:"forged"})).rejects.toThrow("iron.commerce_input_invalid");
  });

  it("lists an annual commercial SKU when IRON publishes only its canonical tier",async()=>{
    const annual:TestPlan={planCode:"IRON_START_Y_2026",name:"Start Anual",interval:"yearly",
      amountMinor:142800,status:"active"};
    const commercial=create({
      billingPlans:[annual],
      plans:{plans:[{plan_code:"IRON_START",version:1}]},
      env:{FMCC_CAKTO_CHECKOUTS_JSON:JSON.stringify([{
        offerId:"annual_offer_ci",productId:"annual_product_ci",
        checkoutUrl:"https://pay.cakto.com.br/annual_offer_ci",
        amountMinor:142800,interval:"year",
      }])},
    });
    await expect(commercial.offers()).resolves.toEqual([{
      planCode:annual.planCode,name:annual.name,interval:"yearly",
      amountMinor:annual.amountMinor,currency:"BRL",
    }]);
  });

  it("preserves the annual commercial SKU for pricing while authorizing canonical entitlements",async()=>{
    const annual:TestPlan={planCode:"IRON_START_Y_2026",name:"Start Anual",interval:"yearly",
      amountMinor:142800,status:"active"};
    let prepared=false;
    const commercial=create({
      billingPlans:[annual],
      plans:{plans:[{plan_code:"IRON_START",version:3}]},
      onPrepare:async x=>{
        prepared=true;
        expect(x.planCode).toBe("IRON_START_Y_2026");
        expect(x.externalTenantId).toBe(gym);
        throw Error("test_prepared_without_real_checkout");
      },
    });
    await expect(commercial.prepare({...req,planCode:annual.planCode}))
      .rejects.toThrow("test_prepared_without_real_checkout");
    expect(prepared).toBe(true);
  });

  it("fails closed on a forged annual SKU with a monthly billing plan before invoice issuance",async()=>{
    let prepared=false;
    const commercial=create({
      billingPlans:[{planCode:"IRON_START_Y_2026",name:"Invalid",interval:"monthly",
        amountMinor:14700,status:"active"}],
      plans:{plans:[{plan_code:"IRON_START",version:1}]},
      onPrepare:()=>{prepared=true;throw Error("must_not_issue_invoice");},
    });
    await expect(commercial.prepare({...req,planCode:"IRON_START_Y_2026"}))
      .rejects.toThrow("iron.commercial_sku_interval_mismatch");
    expect(prepared).toBe(false);
  });

  it("refuses disabled sales and inactive billing plans without issuing invoices",async()=>{
    let prepared=false;
    const onPrepare=()=>{prepared=true;throw Error("must_not_issue_invoice");};
    await expect(create({env:{FMCC_IRON_COMMERCIAL_SALES_ENABLED:"false"},onPrepare})
      .prepare(req)).rejects.toThrow("iron.commerce_sales_disabled");
    await expect(create({billingPlans:[{planCode:"IRON_PRO",name:"Pro",
      interval:"monthly",amountMinor:26900,status:"inactive"}],onPrepare})
      .prepare(req)).rejects.toThrow("iron.commerce_billing_plan_not_available");
    expect(prepared).toBe(false);
  });

});
