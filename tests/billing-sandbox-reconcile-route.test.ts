import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  context: vi.fn(), stepUp: vi.fn(), audit: vi.fn(), reconcile: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../src/application/security/resolve-tenant-context", () => ({ resolveTenantContext: mocks.context }));
vi.mock("../src/application/security/password-step-up", () => ({ verifyPasswordStepUp: mocks.stepUp }));
vi.mock("../src/application/audit/record-audit-event", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("../src/application/billing/canonical-billing-service", () => ({
 CanonicalBillingService: class { reconcile(...args: unknown[]) { return mocks.reconcile(...args); } },
}));
vi.mock("../src/infrastructure/billing/postgres-canonical-billing-repository", () => ({
 PostgresCanonicalBillingRepository: class {},
}));
vi.mock("../src/infrastructure/billing/asaas-sandbox-client", () => ({
 AsaasSandboxClient: class {},
}));
import { POST } from "../src/app/api/billing/sandbox/reconcile/route";
const invoiceId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const request = (input: object) => new Request("http://localhost/api/billing/sandbox/reconcile", { method:"POST", headers:{"content-type":"application/json"},body:JSON.stringify(input) });
const payload = {password:"not-a-real-password",invoiceId,paymentId:"pay_fake"};
beforeEach(() => {
 vi.clearAllMocks();
 mocks.audit.mockResolvedValue(undefined);
 mocks.context.mockResolvedValue({tenantId:"fm",userId:"owner1",role:"owner",correlationId:"req1"});
 mocks.stepUp.mockResolvedValue({userId:"owner1",verifiedAt:new Date()});
 mocks.reconcile.mockResolvedValue("paid");
});
describe("sandbox reconciliation access integration",()=>{
 it("denies anonymous requests before provider or database reconciliation",async()=>{
  mocks.context.mockRejectedValue(new Error("unauthorized"));
  expect((await POST(request(payload))).status).toBe(403);
  expect(mocks.reconcile).not.toHaveBeenCalled();
 });
 it("denies operator role even with a password",async()=>{
  mocks.context.mockResolvedValue({tenantId:"fm",userId:"u1",role:"viewer",correlationId:"req1"});
  expect((await POST(request(payload))).status).toBe(403);
  expect(mocks.reconcile).not.toHaveBeenCalled();
 });
 it("denies wrong password proof principal",async()=>{
  mocks.stepUp.mockResolvedValue({userId:"another",verifiedAt:new Date()});
  expect((await POST(request(payload))).status).toBe(403);
  expect(mocks.reconcile).not.toHaveBeenCalled();
 });
 it("rejects malformed identifiers before provider request",async()=>{
  expect((await POST(request({...payload,invoiceId:"../other"}))).status).toBe(400);
  expect(mocks.reconcile).not.toHaveBeenCalled();
 });
 it("reconciles only within authenticated tenant and audits result",async()=>{
  const response=await POST(request(payload));
  expect(response.status).toBe(200);
  expect(mocks.reconcile).toHaveBeenCalledWith("fm",invoiceId,"pay_fake");
  expect(mocks.audit).toHaveBeenCalledOnce();
 });
});
