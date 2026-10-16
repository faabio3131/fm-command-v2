import { describe,expect,it } from "vitest";
import { readFile } from "node:fs/promises";
import { verifyScheduledWorkerBearer } from "@/application/security/verify-scheduled-worker-bearer";

const secret="only-ci-scheduled-worker-secret-40-chars-nonprod";

describe("D11 independently gated system-to-IRON license delivery",()=>{
  it("accepts only the dedicated exact bearer secret",()=>{
    expect(verifyScheduledWorkerBearer("Bearer "+secret,secret)).toBe(true);
    expect(verifyScheduledWorkerBearer("Bearer wrong",secret)).toBe(false);
    expect(verifyScheduledWorkerBearer("bearer "+secret,secret)).toBe(false);
    expect(verifyScheduledWorkerBearer(secret,secret)).toBe(false);
    expect(verifyScheduledWorkerBearer("Bearer "+secret,undefined)).toBe(false);
    expect(verifyScheduledWorkerBearer("Bearer 123","123")).toBe(false);
    expect(verifyScheduledWorkerBearer("Bearer "+secret,"bad secret with spaces")).toBe(false);
  });

  it("requires three independent disabled-by-default authorization gates",async()=>{
    const route=await readFile("src/app/api/internal/billing/iron/outbox/process-one/route.ts","utf8");
    expect(route).toContain('FMCC_IRON_OUTBOX_AUTOMATIC_DELIVERY_ENABLED!=="YES"');
    expect(route).toContain('FMCC_IRON_OUTBOX_DELIVERY_ENABLED!=="YES"');
    expect(route).toContain('FMCC_IRON_PAID_LICENSE_RECONCILIATION_ENABLED!=="YES"');
    expect(route).toContain("FMCC_IRON_OUTBOX_WORKER_SECRET");
    expect(route).toContain("billing.iron_outbox_worker_secret_not_segregated");
    expect(route).toContain("FMCC_IRON_ASAAS_WEBHOOK_WORKER_SECRET");
    expect(route).toContain("FMCC_ASAAS_PRODUCTION_API_KEY");
    expect(route).toContain("verifyScheduledWorkerBearer");
    expect(route).toContain("environmentIronControlTenantId()");
    expect(route).not.toContain("request.json()");
  });

  it("uses exactly one canonical FM-owned source and the existing GovernedIronOutboxDispatcher",async()=>{
    const route=await readFile("src/app/api/internal/billing/iron/outbox/process-one/route.ts","utf8");
    expect(route).toContain("sources.length!==1");
    expect(route).toContain('source.name==="IRON FIT CORE Commercial"');
    expect(route).toContain("source.secretRef===IRON_COMMERCIAL_SECRET_REF");
    expect(route).toContain('userId:"fmcc:iron-outbox-scheduler"');
    expect(route).toContain("GovernedIronOutboxDispatcher");
    expect(route).toContain("PostgresIronEntitlementOutbox");
    expect(route).toContain("IronCommercialConnector");
    expect(route).not.toContain("commitVerified(");
    expect(route).not.toContain("createOnce(");
  });

  it("the existing Asaas verification worker still uses independent authentication and gating",async()=>{
    const route=await readFile("src/app/api/internal/billing/iron/asaas-webhook/process-one/route.ts","utf8");
    expect(route).toContain("verifyScheduledWorkerBearer");
    expect(route).toContain("FMCC_IRON_ASAAS_WEBHOOK_WORKER_SECRET");
    expect(route).not.toContain("FMCC_IRON_OUTBOX_WORKER_SECRET");
    expect(route).toContain('FMCC_IRON_ASAAS_WEBHOOK_PROCESSOR_ENABLED!=="YES"');
  });

  it("does not run the GitHub scheduled job without explicit URL/secret configuration",async()=>{
    const workflow=await readFile(".github/workflows/fmcc-iron-outbox-delivery.yml","utf8");
    expect(workflow).toContain('if: steps.gate.outputs.ready == \'true\'');
    expect(workflow).toContain('ready=false');
    expect(workflow).toContain("secrets.FMCC_IRON_OUTBOX_WORKER_SECRET");
    expect(workflow).toContain('--output "$response_file"');
    expect(workflow).toContain('retry|blocked|lease_lost');
    expect(workflow).toContain('Governed IRON outbox: $result');
    expect(workflow).not.toContain('cat "$response_file"');
  });
});
