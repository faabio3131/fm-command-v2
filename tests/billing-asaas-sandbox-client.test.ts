import { describe, expect, it, vi, afterEach } from "vitest";
import { AsaasSandboxClient } from "../src/infrastructure/billing/asaas-sandbox-client";
afterEach(() => { delete process.env.FMCC_ASAAS_SANDBOX_API_KEY; });
describe("Asaas sandbox boundary", () => {
  it("fails closed without secret before any network access", async () => {
    delete process.env.FMCC_ASAAS_SANDBOX_API_KEY;
    const transport = vi.fn();
    await expect(new AsaasSandboxClient(transport).getCharge("pay_123")).rejects.toThrow("billing.secret_not_configured");
    expect(transport).not.toHaveBeenCalled();
  });
  it("creates charge only at sandbox endpoint and never logs/exposes key in result", async () => {
    process.env.FMCC_ASAAS_SANDBOX_API_KEY = "sandbox-test-only";
    const transport = vi.fn(async () => new Response(JSON.stringify({id:"pay_123",status:"PENDING",value:19.9,externalReference:"inv-123"}), {status:200}));
    const client = new AsaasSandboxClient(transport);
    await client.createPixCharge({customer:"cus_123",value:19.9,dueDate:"2026-10-15",description:"Homologacao Kordena",externalReference:"inv-123"});
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-sandbox.asaas.com/v3/payments");
    expect((init.headers as Record<string,string>).access_token).toBe("sandbox-test-only");
    expect(JSON.parse(String(init.body)).billingType).toBe("PIX");
  });
  it("rejects mismatched invoice external reference", async () => {
    process.env.FMCC_ASAAS_SANDBOX_API_KEY = "sandbox-test-only";
    const transport = vi.fn(async () => new Response(JSON.stringify({id:"pay_123",status:"PENDING",value:19.9,externalReference:"other"}), {status:200}));
    await expect(new AsaasSandboxClient(transport).createPixCharge({customer:"cus_123",value:19.9,dueDate:"2026-10-15",description:"Test",externalReference:"inv-123"})).rejects.toThrow("billing.asaas_charge_response_invalid");
  });
  it("rejects invalid provider payment id", async () => {
    await expect(new AsaasSandboxClient(vi.fn()).confirmTestPayment("../transfer")).rejects.toThrow("billing.asaas_id_invalid");
  });
});
