import { describe, expect, it, vi } from "vitest";
import { IronAiCreditOutboxWorker } from "@/application/billing/iron-ai-credit-outbox-worker";

const jobId="be53bd75-bf52-42cf-abd0-8b9b43a79bbd";
const invoice="fa9c7a11-5725-4495-bc16-f09a86c52d3e";
const gym="00d4727a-03d4-4d5a-915f-b2a3e45f6dc0";
const env = {
  FMCC_IRON_CONTROL_PLANE_URL:"https://api.ironfitcore.com.br/api/v1/control-plane/fmcc",
  FMCC_IRON_CONTROL_PLANE_TOKEN:"test-only-secret-credit-worker-123456789000",
};

function harness(event:"GRANT"|"REVOKE", order:"paid"|"refunded"="paid", status=200) {
  const calls: Array<{url:string;body:Record<string,unknown>;headers:HeadersInit|undefined}>=[];
  const statements:string[]=[];
  const query=vi.fn(async (sql:string, values:unknown[]=[])=>{
    const q=sql.toLowerCase();
    statements.push(q);
    if(q.includes("returning id,order_id,event_type,attempts,claim_token"))
      return {rows:[{id:jobId,order_id:invoice,event_type:event,attempts:1,claim_token:invoice}],rowCount:1};
    if(q.includes("select o.gym_id"))
      return {rows:[{gym_id:gym,package_code:"IRON_AI_WORKOUT_100",order_status:order,
        subscription_status:"active",paid_through:new Date(Date.now()+86400000)}],rowCount:1};
    if(q.includes("set status='delivered'") || q.includes("set status=$3"))
      return {rows:[],rowCount:1};
    throw Error("Unexpected SQL "+q.slice(0,120));
  });
  const request=vi.fn(async (input:string|URL|Request,init?:RequestInit)=>{
    calls.push({url:String(input),body:JSON.parse(String(init?.body)) as Record<string,unknown>,headers:init?.headers});
    return {ok:status===200,status} as Response;
  }) as unknown as typeof fetch;
  return {worker:new IronAiCreditOutboxWorker({query} as never,env,request),
    calls,query,statements};
}
describe("FM Command -> IRON durable credit delivery",()=>{
  it("delivers a verified paid credit grant with no secrets or student data in payload",async()=>{
    const {worker,calls}=harness("GRANT");
    expect(await worker.processOne()).toBe("delivered");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(env.FMCC_IRON_CONTROL_PLANE_URL+"/ai/credits/grant");
    expect(calls[0].body).toEqual({
      tenantId:gym,sourceInvoiceId:invoice,packageCode:"IRON_AI_WORKOUT_100",paymentStatus:"PAID",
    });
  });
  it("delivers refund revocation only after canonical refunded order",async()=>{
    const {worker,calls}=harness("REVOKE","refunded");
    expect(await worker.processOne()).toBe("delivered");
    expect(calls[0].url).toContain("/ai/credits/revoke");
    expect(calls[0].body).toEqual({tenantId:gym,sourceInvoiceId:invoice});
  });
  it("skips an undelivered GRANT after refund, avoiding resurrection of refunded credits",async()=>{
    const {worker,calls}=harness("GRANT","refunded");
    expect(await worker.processOne()).toBe("delivered");
    expect(calls).toHaveLength(0);
  });
  it("never delivers a grant without active commercial status and paid period",async()=>{
    const {worker,calls,statements}=harness("GRANT","refunded");
    expect(await worker.processOne()).toBe("delivered");
    expect(calls).toHaveLength(0);
    expect(statements.some(s=>s.includes("set status='delivered'"))).toBe(true);
  });
  it("retries a failed S2S delivery without forging a success",async()=>{
    const {worker,calls,statements}=harness("GRANT","paid",503);
    expect(await worker.processOne()).toBe("retry");
    expect(calls).toHaveLength(1);
    expect(statements.some(s=>s.includes("set status=$3"))).toBe(true);
  });
  it("rejects an untrusted destination before delivering credit events",async()=>{
    const {calls}=harness("GRANT");
    const fake=new IronAiCreditOutboxWorker({query:async(q:string)=>q.includes("returning id,order_id,event_type,attempts,claim_token")
      ? {rows:[{id:jobId,order_id:invoice,event_type:"GRANT",attempts:1,claim_token:invoice}],rowCount:1}
      : {rows:[{gym_id:gym,package_code:"IRON_AI_WORKOUT_100",order_status:"paid",
        subscription_status:"active",paid_through:new Date(Date.now()+86400000)}],rowCount:1}} as never,
      {...env,FMCC_IRON_CONTROL_PLANE_URL:"https://evil.example/api/v1/control-plane/fmcc"},
      vi.fn() as unknown as typeof fetch);
    expect(await fake.processOne()).toBe("blocked");
    expect(calls).toHaveLength(0);
  });
});
