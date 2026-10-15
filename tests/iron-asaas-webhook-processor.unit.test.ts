import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { VerifiedIronAsaasWebhookProcessor } from "@/application/billing/verified-iron-asaas-webhook-processor";
import type { PostgresIronAsaasWebhookQueue, ClaimedIronWebhook } from "@/infrastructure/billing/postgres-iron-asaas-webhook-queue";
import type { PostgresIronAsaasAtomicReconciliation } from "@/infrastructure/billing/postgres-iron-asaas-atomic-reconciliation";
import type { AsaasIronPaymentReadOnlyClient } from "@/infrastructure/billing/asaas-iron-payment-readonly-client";

const tenantId="fm-ci-tenant",productId="42a22d47-f1d0-490c-b770-758780479c18";
const invoiceId="3e5dccbc-6e40-44dd-bd5e-8b35f4a67f15";
const claim:ClaimedIronWebhook={
  id:"d37f7e40-c44c-4453-ae67-eacdc5a8b5ad",
  tenantId,productId,invoiceId,eventId:"evt_ci_iron_2026",
  eventType:"PAYMENT_RECEIVED",paymentId:"pay_ci_iron_payment",
  reference:"fmcc-iron-"+invoiceId,claimToken:"token-ci",
};
const binding={
  tenantId,productId,invoiceId,subscriptionId:"3c19fece-eebe-4db4-9ccd-715444ca8a62",
  gatewayAccountId:"1232d339-9b03-4d86-a7d2-6c1dcd0b6058",
  paymentId:claim.paymentId,customerId:"cus_ci_iron_customer",amountMinor:1990,
};
const verified={
  id:claim.paymentId,customer:binding.customerId,
  externalReference:claim.reference,valueMinor:1990,
  billingType:"UNDEFINED" as const,status:"RECEIVED" as const,
};

function fixture(args:{
  item?:ClaimedIronWebhook|null;
  providerStatus?:"RECEIVED"|"REFUNDED";
  bindingPresent?:boolean;
  providerFails?:boolean;
  commitFails?:boolean;
  acknowledge?:boolean;
}={}) {
  const queue={
    claimOne:vi.fn(async()=>args.item===undefined?claim:args.item),
    acknowledge:vi.fn(async()=>args.acknowledge??true),
    fail:vi.fn(async()=>true),
  };
  const ledger={
    binding:vi.fn(async()=>args.bindingPresent===false?null:binding),
    commitVerified:vi.fn(async()=>{
      if(args.commitFails)throw new Error("db unavailable");
      return {invoiceId,eventId:"outbox-ci-event",
        eventType:"LICENSE_ACTIVATE" as const,inserted:true};
    }),
  };
  const provider={
    verify:vi.fn(async()=>{
      if(args.providerFails)throw new Error("billing.iron_asaas_get_unavailable");
      return {...verified,status:args.providerStatus??"RECEIVED"};
    }),
  };
  const processor=new VerifiedIronAsaasWebhookProcessor(
    queue as unknown as Pick<PostgresIronAsaasWebhookQueue,"claimOne"|"acknowledge"|"fail">,
    ledger as unknown as Pick<PostgresIronAsaasAtomicReconciliation,"binding"|"commitVerified">,
    provider as unknown as Pick<AsaasIronPaymentReadOnlyClient,"verify">,
  );
  return {queue,ledger,provider,processor};
}

describe("D11 inbox -> authoritative provider GET -> atomic financial reconciliation",()=>{
  it("does nothing when the durable inbox is empty",async()=>{
    const f=fixture({item:null});
    expect(await f.processor.processOne(tenantId)).toEqual({status:"empty"});
    expect(f.provider.verify).not.toHaveBeenCalled();
    expect(f.ledger.commitVerified).not.toHaveBeenCalled();
  });
  it("commits only after exact canonical binding and authenticated Asaas GET",async()=>{
    const f=fixture();
    expect(await f.processor.processOne(tenantId)).toMatchObject({
      status:"reconciled",eventType:"LICENSE_ACTIVATE",createdOutboxEvent:true,
    });
    expect(f.queue.claimOne).toHaveBeenCalledWith(tenantId);
    expect(f.ledger.binding).toHaveBeenCalledWith(tenantId,productId,invoiceId);
    expect(f.provider.verify).toHaveBeenCalledWith({
      paymentId:claim.paymentId,invoiceId,customerId:binding.customerId,amountMinor:1990,
    });
    expect(f.provider.verify.mock.invocationCallOrder[0])
      .toBeLessThan(f.ledger.commitVerified.mock.invocationCallOrder[0]);
    expect(f.queue.acknowledge).toHaveBeenCalledWith(claim);
    expect(f.queue.fail).not.toHaveBeenCalled();
  });
  it("blocks forged payment ID and wrong academy without contacting provider",async()=>{
    const f=fixture({item:{...claim,paymentId:"pay_other"}});
    expect((await f.processor.processOne(tenantId)).status).toBe("blocked");
    expect(f.provider.verify).not.toHaveBeenCalled();
    expect(f.ledger.commitVerified).not.toHaveBeenCalled();
    expect(f.queue.fail).toHaveBeenCalledWith(expect.anything(),"WEBHOOK_AUTHORITY_REVIEW",true);
  });
  it("never reactivates a refunded payment from a late RECEIVED webhook",async()=>{
    const f=fixture({providerStatus:"REFUNDED"});
    expect((await f.processor.processOne(tenantId)).status).toBe("blocked");
    expect(f.ledger.commitVerified).not.toHaveBeenCalled();
    expect(f.queue.fail).toHaveBeenCalledWith(expect.anything(),"WEBHOOK_AUTHORITY_REVIEW",true);
  });
  it("uses verified REFUNDED evidence to create suspension only via the canonical ledger",async()=>{
    const item={...claim,eventType:"PAYMENT_REFUNDED" as const};
    const f=fixture({item,providerStatus:"REFUNDED"});
    expect((await f.processor.processOne(tenantId)).status).toBe("reconciled");
    expect(f.ledger.commitVerified).toHaveBeenCalledWith(
      expect.objectContaining({tenantId,userId:"fmcc:iron-asaas-webhook-worker"}),
      binding,expect.objectContaining({status:"REFUNDED"}),
    );
  });
  it("retries missing binding, provider outages and DB failure without ACK or mutation",async()=>{
    for(const input of [{bindingPresent:false},{providerFails:true},{commitFails:true}]){
      const f=fixture(input);
      expect((await f.processor.processOne(tenantId)).status).toBe("retry");
      expect(f.queue.fail).toHaveBeenCalledOnce();
      expect(f.queue.acknowledge).not.toHaveBeenCalled();
    }
  });
  it("never claims success when a stale lease prevents acknowledgement",async()=>{
    const f=fixture({acknowledge:false});
    expect((await f.processor.processOne(tenantId)).status).toBe("lease_lost");
  });
  it("keeps worker separately gated and uses no POST to Asaas or IRON directly",async()=>{
    const route=await readFile("src/app/api/internal/billing/iron/asaas-webhook/process-one/route.ts","utf8");
    const worker=await readFile("src/application/billing/verified-iron-asaas-webhook-processor.ts","utf8");
    expect(route).toContain('FMCC_IRON_ASAAS_WEBHOOK_PROCESSOR_ENABLED!=="YES"');
    expect(route).toContain('FMCC_IRON_ASAAS_ATOMIC_RECONCILIATION_ENABLED!=="YES"');
    expect(route).toContain("FMCC_IRON_ASAAS_WEBHOOK_WORKER_SECRET");
    expect(worker).not.toContain("subscriptionCommand(");
    expect(worker).not.toContain("createOnce(");
  });
});
