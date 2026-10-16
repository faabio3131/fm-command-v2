import { describe,expect,it,vi } from "vitest";
import { CanonicalBillingService, type CanonicalBillingRepository } from "../src/application/billing/canonical-billing-service";
import type { BillingAttribution } from "../src/domain/billing/payment-attribution";
const kordena: BillingAttribution={tenantId:"fm",productId:"kordena",customerId:"alice",subscriptionId:"sub-a",invoiceId:"inv-a",gatewayAccountId:"asaas-sandbox",environment:"sandbox",amountMinor:1990,currency:"BRL"};
const iron: BillingAttribution={...kordena,productId:"iron",customerId:"bob",subscriptionId:"sub-b",invoiceId:"inv-b"};
function setup() {
 const invoices=new Map([["inv-a",kordena],["inv-b",iron]]);
 const payments=new Map<string,{invoiceId:string;status:string}>();
 const paid:string[]=[];
 const reserved = new Set<string>();
 const repo: CanonicalBillingRepository={
  findInvoice:vi.fn(async(t,id)=>t==="fm"?invoices.get(id)??null:null),
  findPayment:vi.fn(async(t,g,p)=>t==="fm"&&g==="asaas-sandbox"?payments.get(p)??null:null),
  findInvoicePayment:vi.fn(async(t,id)=>[...payments.entries()].find(([,v])=>t==="fm"&&v.invoiceId===id)?.[0]?{externalPaymentId:[...payments.entries()].find(([,v])=>v.invoiceId===id)![0]}:null),
  reserveInvoiceForCharge:vi.fn(async(t,id)=>{if(t!=="fm" || reserved.has(id))return false;reserved.add(id);return true;}),
  recoverPayment:vi.fn(async({binding,externalPaymentId,status})=>{payments.set(externalPaymentId,{invoiceId:binding.invoiceId,status});}),
  recordPayment:vi.fn(async({binding,externalPaymentId,status})=>{payments.set(externalPaymentId,{invoiceId:binding.invoiceId,status});}),
  markInvoicePaid:vi.fn(async(t,id)=>{paid.push(t+":"+id);}),
 };
 const gateway={createPixCharge:vi.fn(async(x:{externalReference:string;value:number})=>({id:"pay-"+x.externalReference,status:"PENDING",value:x.value,externalReference:x.externalReference})),getCharge:vi.fn(async(id:string)=>({id,status:"RECEIVED",value:19.9,externalReference:id.replace("pay-","")}))};
 return {service:new CanonicalBillingService(repo,gateway),gateway,paid};
}
describe("FM Command canonical invoice binding",()=>{
 it("reconciles one customer's Kordena invoice",async()=>{
  const x=setup();await x.service.createCharge("fm","inv-a","cus-a","2026-10-20");
  expect(await x.service.reconcile("fm","inv-a","pay-inv-a")).toBe("paid");
  expect(x.paid).toEqual(["fm:inv-a"]);
 });
 it("cannot settle IRON's invoice using Kordena payment",async()=>{
  const x=setup();await x.service.createCharge("fm","inv-a","cus-a","2026-10-20");
  await expect(x.service.reconcile("fm","inv-b","pay-inv-a")).rejects.toThrow("billing.payment_binding_mismatch");
  expect(x.paid).toEqual([]);
 });
 it("cannot use an unrelated tenant's invoice",async()=>{
  const x=setup();await expect(x.service.createCharge("other","inv-a","cus-a","2026-10-20")).rejects.toThrow("billing.invoice_not_found");
  expect(x.gateway.createPixCharge).not.toHaveBeenCalled();
 });
 it("prevents duplicate charges for an existing invoice",async()=>{
  const x=setup();await x.service.createCharge("fm","inv-a","cus-a","2026-10-20");
  await expect(x.service.createCharge("fm","inv-a","cus-a","2026-10-20")).rejects.toThrow("billing.payment_already_registered");
 });
 it("never retries automatically after uncertain provider timeout",async()=>{
  const x=setup();
  x.gateway.createPixCharge.mockRejectedValueOnce(new Error("network_timeout"));
  await expect(x.service.createCharge("fm","inv-a","cus-a","2026-10-20")).rejects.toThrow("network_timeout");
  await expect(x.service.createCharge("fm","inv-a","cus-a","2026-10-20")).rejects.toThrow("billing.invoice_not_available");
  expect(x.gateway.createPixCharge).toHaveBeenCalledTimes(1);
 });
 it("recovers verified provider payment without reissuing a charge",async()=>{
   const x=setup();
   const result=await x.service.recoverUncertainCharge("fm","inv-a","pay-inv-a");
   expect(result).toBe("recovered");
   expect(x.gateway.createPixCharge).not.toHaveBeenCalled();
   expect(await x.service.recoverUncertainCharge("fm","inv-a","pay-inv-a")).toBe("already_recorded");
 });
 it("rejects recovery across SaaS invoices",async()=>{
   const x=setup();
   await expect(x.service.recoverUncertainCharge("fm","inv-b","pay-inv-a")).rejects.toThrow("billing.gateway_response_mismatch");
 });
 it("rejects wrong amount from provider",async()=>{
  const x=setup();await x.service.createCharge("fm","inv-a","cus-a","2026-10-20");
  x.gateway.getCharge.mockResolvedValueOnce({id:"pay-inv-a",status:"RECEIVED",value:20,externalReference:"inv-a"});
  await expect(x.service.reconcile("fm","inv-a","pay-inv-a")).rejects.toThrow("billing.payment_amount_mismatch");
  expect(x.paid).toEqual([]);
 });
});
