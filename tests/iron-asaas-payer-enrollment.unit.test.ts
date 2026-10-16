import { describe,expect,it,vi } from "vitest";
import { readFile } from "node:fs/promises";
import { GovernedIronPayerEnrollment,normalizeIronPayerIdentity } from "@/infrastructure/billing/governed-iron-payer-enrollment";
import type { PostgresIronPayerEnrollment,IronPayerClaim } from "@/infrastructure/billing/postgres-iron-payer-enrollment";
import type { AsaasCheckoutClient,AsaasCustomer } from "@/infrastructure/billing/asaas-checkout-client";

const gymId="8042dfb0-80db-49de-86b1-011c27e7bb5d";
const productId="17e5992d-d9c5-4541-b2df-5a0d4bef8c0f";
const document="52998224725"; // test-only checksum-valid CPF
const claim:IronPayerClaim={
  tenantId:"fm-company",productId,customerId:"b991634f-5539-4d3c-b538-ac54a0e3db11",
  gymId,gatewayAccountId:"a9c85d64-9915-44a1-af6a-374a19eec8df",
  reference:"fmcc-iron-customer-"+gymId,
  created:true,status:"reserved",providerCustomerId:null,
};
const verified:AsaasCustomer={
  id:"cus_ci_iron_academy",cpfCnpj:document,externalReference:claim.reference,
};
const input={tenantId:claim.tenantId,productId,gymId,name:"Academia Exemplo Ltda",cpfCnpj:"529.982.247-25"};

function fixture(opts:{
  current?:Partial<IronPayerClaim>;matched?:AsaasCustomer[];
  documentMatches?:AsaasCustomer[];postError?:boolean;byId?:AsaasCustomer|null;
}={}){
  const initial={...claim,...opts.current};
  const repository={
    reserve:vi.fn(async()=>initial),
    confirm:vi.fn(async()=>true),
    markUncertain:vi.fn(async()=>undefined),
  };
  const provider={
    findCustomers:vi.fn(async()=>opts.matched??[]),
    findCustomersByDocument:vi.fn(async()=>opts.documentMatches??[]),
    customerById:vi.fn(async()=>opts.byId===undefined?verified:opts.byId),
    createIronPayerOnce:vi.fn(async()=>{
      if(opts.postError)throw new Error("billing.asaas_uncertain_response");
      return verified.id;
    }),
  };
  const service=new GovernedIronPayerEnrollment(
    repository as unknown as Pick<PostgresIronPayerEnrollment,"reserve"|"confirm"|"markUncertain">,
    provider as unknown as Pick<AsaasCheckoutClient,"findCustomers"|"findCustomersByDocument"|"customerById"|"createIronPayerOnce">,
  );
  return {service,provider,repository};
}

describe("D11 IRON canonical payer enrollment",()=>{
  it("validates real CPF and CNPJ check digits, name, email and gym before any reservation",()=>{
    expect(normalizeIronPayerIdentity(input)).toMatchObject({cpfCnpj:document,gymId});
    expect(normalizeIronPayerIdentity({...input,cpfCnpj:"11.222.333/0001-81"}).cpfCnpj).toBe("11222333000181");
    for(const cpfCnpj of ["11111111111","52998224726","11222333000180","00000000000000","1234"]){
      expect(()=>normalizeIronPayerIdentity({...input,cpfCnpj})).toThrow("billing.iron_payer_document_invalid");
    }
    expect(()=>normalizeIronPayerIdentity({...input,gymId:"another-tenant"})).toThrow();
    expect(()=>normalizeIronPayerIdentity({...input,email:"not-an-email"})).toThrow();
  });

  it("creates exactly one provider payer after durable claim, safe preflights and exact verification",async()=>{
    const f=fixture();
    const result=await f.service.enroll(input);
    expect(result).toEqual({status:"enrolled",source:"created",customerId:verified.id});
    expect(f.repository.reserve).toHaveBeenCalledWith(input.tenantId,productId,gymId);
    expect(f.provider.findCustomers).toHaveBeenCalledWith(claim.reference);
    expect(f.provider.findCustomersByDocument).toHaveBeenCalledWith(document);
    expect(f.provider.createIronPayerOnce).toHaveBeenCalledOnce();
    expect(f.provider.createIronPayerOnce).toHaveBeenCalledWith({
      reference:claim.reference,name:input.name,cpfCnpj:document,
    });
    expect(f.repository.confirm).toHaveBeenCalledWith(claim,verified.id);
    expect(f.repository.markUncertain).not.toHaveBeenCalled();
    expect(f.repository.reserve.mock.invocationCallOrder[0])
      .toBeLessThan(f.provider.createIronPayerOnce.mock.invocationCallOrder[0]);
  });

  it("recovers prior reservation via GET only, even if original call was uncertain",async()=>{
    const f=fixture({current:{created:false,status:"uncertain"},matched:[verified]});
    expect(await f.service.enroll(input)).toMatchObject({status:"enrolled",source:"recovered"});
    expect(f.provider.createIronPayerOnce).not.toHaveBeenCalled();
    expect(f.repository.confirm).toHaveBeenCalledOnce();
  });

  it("never retries POST for a second operator with an already reserved claim",async()=>{
    const f=fixture({current:{created:false,status:"reserved"}});
    expect(await f.service.enroll(input)).toEqual({status:"manual_review_required"});
    expect(f.provider.createIronPayerOnce).not.toHaveBeenCalled();
  });

  it("uses read-only adoption of an existing same-reference payer",async()=>{
    const f=fixture({matched:[verified]});
    expect(await f.service.enroll(input)).toMatchObject({status:"enrolled",source:"existing"});
    expect(f.provider.createIronPayerOnce).not.toHaveBeenCalled();
    expect(f.repository.confirm).toHaveBeenCalledOnce();
  });

  it("blocks mismatched payer document, duplicate reference and conflicting document without POST",async()=>{
    for(const options of [
      {matched:[verified,{...verified,id:"cus_another"}]},
      {matched:[verified],byId:{...verified,cpfCnpj:"11222333000181"}},
      {documentMatches:[{...verified,externalReference:"fmcc-other-product"}]},
    ]){
      const f=fixture(options);
      await expect(f.service.enroll(input)).rejects.toThrow("billing.iron_payer_");
      expect(f.provider.createIronPayerOnce).not.toHaveBeenCalled();
      expect(f.repository.markUncertain).toHaveBeenCalledOnce();
    }
  });

  it("marks ambiguous provider POST uncertain, never does a second POST",async()=>{
    const f=fixture({postError:true});
    expect(await f.service.enroll(input)).toEqual({status:"manual_review_required"});
    expect(f.provider.createIronPayerOnce).toHaveBeenCalledOnce();
    expect(f.repository.markUncertain).toHaveBeenCalledWith(claim,"ENROLLMENT_REQUIRES_REVIEW");
  });

  it("rejects provider identity mismatch after POST without confirming a wrong payer",async()=>{
    const f=fixture({byId:{...verified,externalReference:"fmcc-iron-customer-other-gym"}});
    await expect(f.service.enroll(input)).rejects.toThrow("billing.iron_payer_post_unverified");
    expect(f.repository.confirm).not.toHaveBeenCalled();
    expect(f.repository.markUncertain).toHaveBeenCalledOnce();
  });

  it("rejects issuer bypass: charge reservation requires confirmed canonical enrollment",async()=>{
    const issuer=await readFile("src/infrastructure/billing/postgres-iron-asaas-issuer.ts","utf8");
    expect(issuer).toContain("fmcc_billing_iron_customer_enrollment");
    expect(issuer).toContain("status='enrolled' AND external_customer_id=$6");
    expect(issuer).toContain("billing.iron_issuer_payer_not_enrolled");
    expect(issuer).not.toContain("UPDATE fmcc_billing_customer SET external_customer_id");
    const enroll=await readFile("src/infrastructure/billing/postgres-iron-payer-enrollment.ts","utf8");
    expect(enroll).toContain("UPDATE fmcc_billing_customer SET external_customer_id=$1");
    expect(enroll).toContain("ON CONFLICT (tenant_id,product_id,external_tenant_id) DO NOTHING");
  });

  it("ensures UI and route enforce FM admin step-up and never expose payment or student funds",async()=>{
    const route=await readFile("src/app/api/billing/products/[productId]/iron-license/asaas-payer/route.ts","utf8");
    const page=await readFile("src/app/dashboard/products/[productId]/billing/page.tsx","utf8");
    const panel=await readFile("src/app/dashboard/products/[productId]/billing/iron-payer-enrollment-panel.tsx","utf8");
    expect(route).toContain('FMCC_IRON_ASAAS_PAYER_ENROLLMENT_ENABLED!=="YES"');
    expect(route).toContain('requirePermission(context,"billing:write")');
    expect(route).toContain("verifyPasswordStepUp");
    expect(route).toContain("environmentIronControlTenantId()");
    expect(route).not.toContain("subscription.status.sync");
    expect(page).toContain('product.slug === FMCC_IRON_PRODUCT_SLUG');
    expect(page).toContain("IronCommercialConnector().snapshot");
    expect(panel).toContain("Validar e cadastrar pagador");
    expect(panel).toContain("Nenhuma cobrança");
    expect(panel).not.toContain("localStorage");
  });
});
