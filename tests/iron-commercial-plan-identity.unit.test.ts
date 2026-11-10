import {describe,expect,it} from "vitest";
import {resolveIronCommercialPlanIdentity,assertIronCommercialPlanInterval} from "@/application/billing/iron-commercial-plan-identity";

const tiers=["START","GROWTH","SCALE","ENTERPRISE"];
describe("eight Cakto subscription SKUs to four canonical IRON plans",()=>{
  it("maps each monthly and yearly billing SKU to exactly the same plan family",()=>{
    const identities=tiers.flatMap(tier=>(["M","Y"] as const).map(period=>
      resolveIronCommercialPlanIdentity("IRON_"+tier+"_"+period+"_2026")));
    expect(identities).toHaveLength(8);
    expect(new Set(identities.map(i=>i.billingPlanCode)).size).toBe(8);
    expect(new Set(identities.map(i=>i.canonicalPlanCode)).size).toBe(4);
    for(const identity of identities){
      expect(identity.candidate).toBe(true);
      expect(assertIronCommercialPlanInterval(identity.billingPlanCode,identity.billingInterval!))
        .toBe(identity.canonicalPlanCode);
    }
  });
  it("fails closed on mismatching subscription interval without touching canonical authority",()=>{
    expect(()=>assertIronCommercialPlanInterval("IRON_START_M_2026","yearly")).toThrow("iron.commercial_sku_interval_mismatch");
    expect(()=>assertIronCommercialPlanInterval("IRON_ENTERPRISE_Y_2026","monthly")).toThrow("iron.commercial_sku_interval_mismatch");
    expect(()=>assertIronCommercialPlanInterval("IRON_SCALE_M_2027","monthly")).toThrow("iron.commercial_sku_version_unrecognized");
  });
  it("preserves preexisting canonical plan subscriptions and validates their periods",()=>{
    expect(resolveIronCommercialPlanIdentity("IRON_PRO")).toMatchObject({
      billingPlanCode:"IRON_PRO",canonicalPlanCode:"IRON_PRO",billingInterval:null,candidate:false,
    });
    expect(assertIronCommercialPlanInterval("IRON_PRO","monthly")).toBe("IRON_PRO");
    expect(()=>assertIronCommercialPlanInterval("IRON_PRO","one_time")).toThrow("iron.commercial_sku_interval_invalid");
    expect(()=>resolveIronCommercialPlanIdentity("IRON_PRO; DROP TABLE")).toThrow("iron.commercial_plan_code_invalid");
  });
});
