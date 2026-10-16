import { afterEach, describe, expect, it, vi } from "vitest";
import { AsaasIronIssuerClient } from "@/infrastructure/billing/asaas-iron-issuer-client";
import { AsaasIronPaymentReadOnlyClient, ironAsaasInvoiceReference } from "@/infrastructure/billing/asaas-iron-payment-readonly-client";

const invoiceId="d647ae0d-49e6-41ed-a7b4-31d731489ca5";
const paymentId="pay_multimethod_ci";
const customerId="cus_multimethod_ci";
const invoiceUrl="https://www.asaas.com/i/pay_multimethod_ci";
const ref=ironAsaasInvoiceReference(invoiceId);
const dueDate=new Date(Date.now()+86400000).toISOString().slice(0,10);
const details={invoiceId,customerId,amountMinor:12990};
const payment={id:paymentId,customer:customerId,externalReference:ref,billingType:"UNDEFINED",status:"PENDING",value:129.90,invoiceUrl};

afterEach(()=>vi.unstubAllEnvs());

describe("D11 Asaas hosted invoice — Pix, credit card and boleto",()=>{
  it("issues exactly one canonical UNDEFINED invoice, without PAN/CVV or multiple charges",async()=>{
    vi.stubEnv("FMCC_ASAAS_PRODUCTION_API_KEY","ci-not-real");
    const fetcher=vi.fn(async (url:string, options?:RequestInit)=>{
      if(options?.method==="POST") return new Response(JSON.stringify(payment),{status:200});
      return new Response(JSON.stringify({hasMore:false,data:[]}),{status:200});
    });
    const client=new AsaasIronIssuerClient(fetcher as typeof fetch);
    expect(await client.findUnique(details)).toBeNull();
    const result=await client.createOnce({...details,dueDate});
    expect(result).toMatchObject({id:paymentId,billingType:"UNDEFINED",invoiceUrl});
    const post=fetcher.mock.calls.find(([,options])=>options?.method==="POST");
    expect(post).toBeDefined();
    const body=JSON.parse(String(post![1]?.body));
    expect(body).toEqual({
      customer:customerId,billingType:"UNDEFINED",value:129.9,
      dueDate,description:"IRON FIT CORE - Licenca SaaS FM Tecnologia",externalReference:ref,
    });
    expect(JSON.stringify(body)).not.toMatch(/creditCard|cvv|cardNumber|holderName/i);
    expect(fetcher.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(1);
  });

  it.each(["PIX","BOLETO","CREDIT_CARD","UNDEFINED"] as const)(
    "accepts canonical Asaas method %s for the same invoice reference",async type=>{
      const client=new AsaasIronIssuerClient(vi.fn());
      expect(client.validatePayment({...payment,billingType:type},details))
        .toMatchObject({billingType:type,invoiceUrl});
    });

  it("rejects mismatched payment and does not reflect attacker-controlled URLs",()=>{
    const client=new AsaasIronIssuerClient(vi.fn());
    for(const hostile of [
      "http://www.asaas.com/i/1",
      "https://www.asaas.com.evil.invalid/i/1",
      "https://attacker.test/pay",
      "https://user:password@www.asaas.com/i/1",
      "javascript:alert(1)",
    ]) {
      expect(client.validatePayment({...payment,invoiceUrl:hostile},details).invoiceUrl).toBeUndefined();
    }
    expect(()=>client.validatePayment({...payment,customer:"cus_other"},details)).toThrow("billing.iron_asaas_payment_binding_mismatch");
    expect(()=>client.validatePayment({...payment,value:200},details)).toThrow("billing.iron_asaas_payment_binding_mismatch");
  });

  it.each(["PIX","BOLETO","CREDIT_CARD","UNDEFINED"] as const)(
    "requires provider RECEIVED for method %s, not mere invoice creation",async type=>{
      vi.stubEnv("FMCC_ASAAS_PRODUCTION_API_KEY","ci-not-real");
      const mock=vi.fn(async()=>new Response(JSON.stringify({...payment,billingType:type,status:"RECEIVED"}),{status:200}));
      const proof=await new AsaasIronPaymentReadOnlyClient(mock as typeof fetch).verify({
        invoiceId,paymentId,customerId,amountMinor:12990,
      });
      expect(proof.status).toBe("RECEIVED");
      expect(proof.billingType).toBe(type);
      const unreceived=vi.fn(async()=>new Response(JSON.stringify({...payment,billingType:type}),{status:200}));
      await expect(new AsaasIronPaymentReadOnlyClient(unreceived as typeof fetch).verify({
        invoiceId,paymentId,customerId,amountMinor:12990,
      })).rejects.toThrow("billing.iron_asaas_state_requires_review");
    });

  it("fences ambiguous provider GET and conflicting references before issuance",async()=>{
    vi.stubEnv("FMCC_ASAAS_PRODUCTION_API_KEY","ci-not-real");
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({
      data:[payment,{...payment,id:"pay_second"}],hasMore:false,
    }),{status:200}));
    await expect(new AsaasIronIssuerClient(fetcher as typeof fetch).findUnique(details))
      .rejects.toThrow("billing.iron_asaas_preflight_ambiguous");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
