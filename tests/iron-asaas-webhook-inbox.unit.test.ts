import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import {
  IronAsaasWebhookInbox, parseIronAsaasWebhook, verifyIronAsaasWebhookToken,
} from "@/infrastructure/billing/iron-asaas-webhook-inbox";

const invoiceId = "8f99919f-c6ab-45f4-af63-529a833022a9";
const reference = "fmcc-iron-"+invoiceId;
const payload = {
  id:"evt_05b708f961d739ea7eba7e4db318f621&368604920",
  event:"PAYMENT_RECEIVED",
  payment:{id:"pay_080225913252",externalReference:reference,status:"RECEIVED",value:1990},
};

describe("D11 Asaas webhook authentication and read-only inbox",()=>{
  it("enforces a dedicated 32+ character webhook token using constant-time hashes",()=>{
    const secret = "only-ci-webhook-token-32-characters-long-unique";
    expect(verifyIronAsaasWebhookToken(secret,secret)).toBe(true);
    expect(verifyIronAsaasWebhookToken("wrong",secret)).toBe(false);
    expect(verifyIronAsaasWebhookToken(secret,undefined)).toBe(false);
    expect(verifyIronAsaasWebhookToken("123","123")).toBe(false);
    expect(verifyIronAsaasWebhookToken("key with spaces","key with spaces")).toBe(false);
  });

  it("captures minimal metadata and does not trust payment amount or status",()=>{
    const event=parseIronAsaasWebhook(payload);
    expect(event).toMatchObject({
      eventId:payload.id,eventType:"PAYMENT_RECEIVED",paymentId:payload.payment.id,
      externalReference:reference,invoiceId,
    });
    expect(event?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(event)).not.toContain("1990");
    expect(JSON.stringify(event)).not.toContain('"status"');
    expect(parseIronAsaasWebhook({...payload,payment:{...payload.payment,value:999,status:"PENDING"}}))
      .toEqual(event);
  });

  it("accepts refunds as notifications only, ignores other products and unsupported events",()=>{
    expect(parseIronAsaasWebhook({...payload,event:"PAYMENT_REFUNDED"})?.eventType)
      .toBe("PAYMENT_REFUNDED");
    expect(parseIronAsaasWebhook({...payload,event:"PAYMENT_CONFIRMED"})).toBeNull();
    expect(parseIronAsaasWebhook({...payload,payment:{...payload.payment,externalReference:"fmcc-kordena-pilot"}}))
      .toBeNull();
  });

  it("rejects malformed iron invoice references, missing payment ids and event ids",()=>{
    expect(()=>parseIronAsaasWebhook({...payload,id:"/../escape"})).toThrow();
    expect(()=>parseIronAsaasWebhook({...payload,payment:{id:"pay_valid",externalReference:"fmcc-iron-invalid"}})).toThrow();
    expect(()=>parseIronAsaasWebhook({...payload,payment:{id:"../forged",externalReference:reference}})).toThrow();
  });

  function fixture(input:{ duplicate?:boolean; mismatch?:boolean; absentInvoice?:boolean }={}) {
    const calls: Array<{sql:string;params:unknown[]}> = [];
    const query=vi.fn(async(sql:string, params:unknown[]=[])=>{
      calls.push({sql,params});
      if(sql.includes("SELECT g.id, g.tenant_id")) return {
        rowCount:input.absentInvoice?0:1,
        rows:input.absentInvoice?[]:[{id:"gateway-one",tenant_id:"fm-control"}],
      };
      if(sql.includes("INSERT INTO fmcc_billing_gateway_event"))return {
        rowCount:input.duplicate?0:1,rows:input.duplicate?[]:[{id:"new-event"}],
      };
      if(sql.includes("SELECT event_type,external_payment_id"))return {
        rowCount:1,rows:[{
          event_type:"PAYMENT_RECEIVED",external_payment_id:payload.payment.id,
          external_reference:reference,
          payload_fingerprint:input.mismatch?"forged":parseIronAsaasWebhook(payload)!.fingerprint,
        }],
      };
      throw new Error("Unexpected SQL");
    });
    const repo=new IronAsaasWebhookInbox({query} as unknown as Pick<Pool,"query">);
    return {repo,query,calls};
  }

  it("stores an authenticated notification once without changing money or entitlements",async()=>{
    const e=parseIronAsaasWebhook(payload)!;
    const {repo,calls}=fixture();
    expect(await repo.persist("fm-control",e)).toBe("received");
    expect(calls[0].params).toEqual(["fm-control",invoiceId]);
    expect(calls[1].sql).toContain("ON CONFLICT");
    expect(calls[1].params).toContain(e.fingerprint);
    expect(calls.every(c=>!c.sql.includes("UPDATE fmcc_billing_subscription"))).toBe(true);
    expect(calls.every(c=>!c.sql.includes("entitlement_outbox"))).toBe(true);
  });

  it("deduplicates repeated event IDs and quarantines semantic replays",async()=>{
    const e=parseIronAsaasWebhook(payload)!;
    expect(await fixture({duplicate:true}).repo.persist("fm-control",e)).toBe("duplicate");
    await expect(fixture({duplicate:true,mismatch:true}).repo.persist("fm-control",e))
      .rejects.toThrow("billing.iron_webhook_duplicate_conflict");
  });

  it("never invents a scope when the invoice/gateway is not canonical",async()=>{
    const q=fixture({absentInvoice:true});
    expect(await q.repo.persist("fm-control",parseIronAsaasWebhook(payload)!)).toBe("unbound");
    expect(q.calls).toHaveLength(1);
    await expect(q.repo.persist("",parseIronAsaasWebhook(payload)!)).rejects.toThrow();
  });

  it("routes through an explicit disabled-by-default authenticated inbox with no immediate license grant",async()=>{
    const route=await readFile("src/app/api/billing/webhooks/asaas/iron/route.ts","utf8");
    expect(route).toContain('FMCC_IRON_ASAAS_WEBHOOK_INBOX_ENABLED !== "YES"');
    expect(route).toContain('request.headers.get("asaas-access-token")');
    expect(route).toContain("verifyIronAsaasWebhookToken");
    expect(route).toContain('if (status === "unbound")');
    expect(route).toContain('billing.iron_webhook_binding_not_ready');
    expect(route).not.toContain("subscription.status.sync");
    expect(route).not.toContain("commitVerified(");
    const sql=await readFile("drizzle/0009_foundation.sql","utf8");
    expect(sql).toContain('ADD COLUMN "payload_fingerprint"');
  });
});
