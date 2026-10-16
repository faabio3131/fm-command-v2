import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { AsaasIronIssuerClient } from "@/infrastructure/billing/asaas-iron-issuer-client";
import { GovernedIronAsaasIssuance } from "@/infrastructure/billing/governed-iron-asaas-issuance";
import type { PostgresIronAsaasIssuer, IronIssueClaim } from "@/infrastructure/billing/postgres-iron-asaas-issuer";
import type { AsaasCheckoutClient } from "@/infrastructure/billing/asaas-checkout-client";

const tenantId = "fm-operator";
const productId = "f8c680d4-d81d-4ee3-ad36-1012f28f31a6";
const invoiceId = "f3790b4a-11a4-4c5c-87d3-7b9fb6c0a2db";
const gymId = "d93e76eb-168e-4878-a7cf-4c1eb1923e29";
const customerId = "cus_ci_verified";
const paymentId = "pay_ci_issuer";
const dueDate = new Date(Date.now()+24*60*60*1000).toISOString().slice(0,10);
const input = {tenantId,productId,invoiceId,customerId,dueDate};
const claim:IronIssueClaim = {
  tenantId,productId,invoiceId,customerId,
  gatewayAccountId:"b6c0fd19-59c8-4fe5-96b2-f0392d8b0227",
  externalTenantId:gymId,amountMinor:1990,
  reference:"fmcc-iron-"+invoiceId,created:true,status:"reserved",paymentId:null,
};
const payment = {
  id:paymentId,customer:customerId,externalReference:"fmcc-iron-"+invoiceId,
  value:19.90,billingType:"PIX" as const,status:"PENDING",
};
function setup(overrides:{
  claimed?:Partial<IronIssueClaim>;
  existing?:typeof payment|null;
  failPreflight?:boolean;
  failPost?:boolean;
  customerReference?:string;
  providerMatches?:Array<{id:string;externalReference:string}>;
}={}) {
  const repo={
    gymBinding:vi.fn(async()=>gymId),
    reserve:vi.fn(async()=>({...claim,...overrides.claimed})),
    claimForRecovery:vi.fn(async()=>({...claim,created:false,status:"uncertain",...overrides.claimed})),
    persistPayment:vi.fn(async()=> "issued" as const),
    markUncertain:vi.fn(async()=>undefined),
  };
  const provider={
    findUnique:vi.fn(async()=>{
      if(overrides.failPreflight)throw Error("provider GET unavailable");
      return overrides.existing===undefined?null:overrides.existing;
    }),
    createOnce:vi.fn(async()=>{
      if(overrides.failPost)throw Error("provider POST uncertain");
      return payment;
    }),
  };
  const customers={
    findCustomers:vi.fn(async(_reference:string)=>overrides.providerMatches ?? [{
      id:customerId,externalReference:"fmcc-iron-customer-"+gymId,
    }]),
    customerById:vi.fn(async()=>({
      id:customerId,externalReference:overrides.customerReference??"fmcc-iron-customer-"+gymId,
    })),
  };
  const service=new GovernedIronAsaasIssuance(
    repo as unknown as Pick<PostgresIronAsaasIssuer,"gymBinding"|"reserve"|"claimForRecovery"|"persistPayment"|"markUncertain">,
    provider as unknown as Pick<AsaasIronIssuerClient,"findUnique"|"createOnce">,
    customers as unknown as Pick<AsaasCheckoutClient,"customerById"|"findCustomers">,
  );
  return {service,repo,provider,customers};
}

describe("D11 single-shot Asaas issuance authority",()=>{
  it("issues one Pix only after customer proof, committed claim and empty authoritative preflight",async()=>{
    const {service,repo,provider,customers}=setup();
    const result=await service.issue(input);
    expect(result).toEqual({status:"issued",paymentId,recovered:false});
    expect(customers.customerById).toHaveBeenCalledWith(customerId);
    expect(repo.reserve).toHaveBeenCalledWith(input);
    expect(provider.findUnique.mock.invocationCallOrder[0]).toBeLessThan(provider.createOnce.mock.invocationCallOrder[0]);
    expect(provider.createOnce).toHaveBeenCalledTimes(1);
    expect(repo.persistPayment).toHaveBeenCalledWith(expect.objectContaining({invoiceId}),payment);
  });

  it("GET-only recovers existing claim and never POSTs after an uncertain outcome",async()=>{
    const {service,provider,repo}=setup({claimed:{created:false,status:"uncertain"}});
    const result=await service.issue(input);
    expect(result.status).toBe("manual_review_required");
    expect(provider.createOnce).not.toHaveBeenCalled();
    expect(repo.markUncertain).toHaveBeenCalledWith(expect.anything(),"RECOVERY_NO_MATCH");
  });

  it("recovers exactly one previously issued Asaas Pix via reference",async()=>{
    const {service,provider,repo}=setup({claimed:{created:false,status:"uncertain"},existing:payment});
    const result=await service.recover({tenantId,productId,invoiceId});
    expect(result).toEqual({status:"issued",paymentId,recovered:true});
    expect(provider.findUnique).toHaveBeenCalledTimes(1);
    expect(provider.createOnce).not.toHaveBeenCalled();
    expect(repo.persistPayment).toHaveBeenCalledTimes(1);
  });

  it("stops before POST if preflight fails; never retries POST after uncertain response",async()=>{
    const preflight=setup({failPreflight:true});
    expect((await preflight.service.issue(input)).status).toBe("manual_review_required");
    expect(preflight.provider.createOnce).not.toHaveBeenCalled();
    expect(preflight.repo.markUncertain).toHaveBeenCalledWith(expect.anything(),"PRECHECK_UNCERTAIN");
    const post=setup({failPost:true});
    expect((await post.service.issue(input)).status).toBe("manual_review_required");
    expect(post.provider.createOnce).toHaveBeenCalledTimes(1);
    expect(post.repo.markUncertain).toHaveBeenCalledWith(expect.anything(),"POST_OR_PERSISTENCE_UNCERTAIN");
  });

  it("rejects mismatched Asaas customer reference and invalid due date before reserving",async()=>{
    const wrong=setup({customerReference:"fmcc-iron-customer-wrong-gym"});
    await expect(wrong.service.issue(input)).rejects.toThrow("billing.iron_issuer_customer_gym_mismatch");
    expect(wrong.repo.reserve).not.toHaveBeenCalled();
    const bad=setup();
    await expect(bad.service.issue({...input,dueDate:"1990-01-01"})).rejects.toThrow();
    expect(bad.repo.reserve).not.toHaveBeenCalled();
  });

  it("resolves a payer without user-supplied customer ID using only the canonical gym reference",async()=>{
    const {service,repo,provider,customers}=setup();
    const result=await service.issue({...input,customerId:undefined});
    expect(result).toEqual({status:"issued",paymentId,recovered:false});
    expect(customers.findCustomers).toHaveBeenCalledWith("fmcc-iron-customer-"+gymId);
    expect(customers.customerById).toHaveBeenCalledWith(customerId);
    expect(repo.reserve).toHaveBeenCalledWith(input);
    expect(provider.createOnce).toHaveBeenCalledTimes(1);
  });

  it("fails closed before any reservation or provider POST for missing or duplicate gym payers",async()=>{
    const missing=setup({providerMatches:[]});
    await expect(missing.service.issue({...input,customerId:undefined}))
      .rejects.toThrow("billing.iron_issuer_customer_enrollment_required");
    expect(missing.repo.reserve).not.toHaveBeenCalled();
    expect(missing.provider.createOnce).not.toHaveBeenCalled();

    const duplicates=setup({providerMatches:[
      {id:"cus_first",externalReference:"fmcc-iron-customer-"+gymId},
      {id:"cus_second",externalReference:"fmcc-iron-customer-"+gymId},
    ]});
    await expect(duplicates.service.issue({...input,customerId:undefined}))
      .rejects.toThrow("billing.iron_issuer_customer_ambiguous");
    expect(duplicates.repo.reserve).not.toHaveBeenCalled();
    expect(duplicates.provider.createOnce).not.toHaveBeenCalled();
  });

  it("revalidates a discovered payer by provider ID and exact canonical reference",async()=>{
    const bad=setup({customerReference:"fmcc-iron-customer-other-gym"});
    await expect(bad.service.issue({...input,customerId:undefined}))
      .rejects.toThrow("billing.iron_issuer_customer_gym_mismatch");
    expect(bad.repo.reserve).not.toHaveBeenCalled();
    expect(bad.provider.createOnce).not.toHaveBeenCalled();
  });

  it("requires explicit disabled-by-default flag and financial permission plus step-up",async()=>{
    const route=await readFile("src/app/api/billing/products/[productId]/iron-license/asaas-issue/route.ts","utf8");
    expect(route).toContain('FMCC_IRON_ASAAS_ISSUANCE_ENABLED !== "YES"');
    expect(route).toContain('requirePermission(ctx,"billing:write")');
    expect(route).toContain("verifyPasswordStepUp");
    expect(route).toContain("environmentIronControlTenantId()");
    expect(route).not.toContain("input.amountMinor");
  });
});
