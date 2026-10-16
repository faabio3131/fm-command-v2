import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AsaasCheckoutClient } from "../src/infrastructure/billing/asaas-checkout-client";

describe("Asaas checkout boundary", () => {
 const original = process.env.FMCC_ASAAS_PRODUCTION_API_KEY;

 beforeEach(() => {
  process.env.FMCC_ASAAS_PRODUCTION_API_KEY = "ci-test-key";
 });

 afterEach(() => {
  if (original === undefined) delete process.env.FMCC_ASAAS_PRODUCTION_API_KEY;
  else process.env.FMCC_ASAAS_PRODUCTION_API_KEY = original;
 });

 it("reuses existing provider customer without POST", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
   ok: true,
   json: async () => ({
    data: [{ id: "cus_existing", externalReference: "fmcc-buyer-123456" }],
   }),
  });
  const result = await new AsaasCheckoutClient(fetchMock).ensureCustomer({
   reference: "fmcc-buyer-123456",
   name: "Cliente Teste",
   cpfCnpj: "12345678909",
  });
  expect(result).toBe("cus_existing");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].method).toBe("GET");
 });

 it("rejects duplicate provider customer references", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
   ok: true,
   json: async () => ({
    data: [
     { id: "cus_one", externalReference: "fmcc-buyer-123456" },
     { id: "cus_two", externalReference: "fmcc-buyer-123456" },
    ],
   }),
  });
  await expect(new AsaasCheckoutClient(fetchMock).ensureCustomer({
   reference: "fmcc-buyer-123456",
   name: "Cliente Teste",
   cpfCnpj: "12345678909",
  })).rejects.toThrow("duplicate");
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });

 it("creates provider customer server-side only after empty lookup", async () => {
  const fetchMock = vi.fn()
   .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
   .mockResolvedValueOnce({
    ok: true,
    json: async () => ({
     id: "cus_new",
     externalReference: "fmcc-buyer-123456",
    }),
   });
  const id = await new AsaasCheckoutClient(fetchMock).ensureCustomer({
   reference: "fmcc-buyer-123456",
   name: "Cliente Teste",
   cpfCnpj: "12345678909",
  });
  expect(id).toBe("cus_new");
  expect(fetchMock.mock.calls[1][1].method).toBe("POST");
 });

 it("validates a saved provider customer by GET before reuse", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
   ok: true,
   status: 200,
   json: async () => ({
    id: "cus_saved",
    externalReference: "fmcc-buyer-123456",
    cpfCnpj: "12345678909",
   }),
  });
  const result = await new AsaasCheckoutClient(fetchMock).reconcileCustomer({
   currentExternalId: "cus_saved",
   reference: "fmcc-buyer-123456",
   name: "Cliente Teste",
   cpfCnpj: "12345678909",
  });
  expect(result).toEqual({ customerId: "cus_saved", source: "saved" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toContain("/customers/cus_saved");
  expect(fetchMock.mock.calls[0][1].method).toBe("GET");
 });

 it("recovers a stale saved customer id by immutable reference", async () => {
  const fetchMock = vi.fn()
   .mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({ errors: [] }),
   })
   .mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
     data: [{
      id: "cus_recovered",
      externalReference: "fmcc-buyer-123456",
      cpfCnpj: "12345678909",
     }],
    }),
   });
  const result = await new AsaasCheckoutClient(fetchMock).reconcileCustomer({
   currentExternalId: "cus_stale",
   reference: "fmcc-buyer-123456",
   name: "Cliente Teste",
   cpfCnpj: "12345678909",
  });
  expect(result).toEqual({ customerId: "cus_recovered", source: "reference" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toContain("/customers/cus_stale");
  expect(fetchMock.mock.calls[1][0]).toContain("externalReference=fmcc-buyer-123456");
 });

 it("recovers customer by CPF/CNPJ before creating a duplicate", async () => {
  const fetchMock = vi.fn()
   .mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({ errors: [] }),
   })
   .mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
   })
   .mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
     data: [{
      id: "cus_by_document",
      cpfCnpj: "12345678909",
     }],
    }),
   });
  const result = await new AsaasCheckoutClient(fetchMock).reconcileCustomer({
   currentExternalId: "cus_stale",
   reference: "fmcc-buyer-123456",
   name: "Cliente Teste",
   cpfCnpj: "12345678909",
  });
  expect(result).toEqual({ customerId: "cus_by_document", source: "document" });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[2][0]).toContain("cpfCnpj=12345678909");
  expect(fetchMock.mock.calls.every(call => call[1].method === "GET")).toBe(true);
 });

 it("creates a replacement customer only when id, reference and document are absent", async () => {
  const fetchMock = vi.fn()
   .mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({ errors: [] }),
   })
   .mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
   })
   .mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
   })
   .mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
     id: "cus_created",
     externalReference: "fmcc-buyer-123456",
     cpfCnpj: "12345678909",
    }),
   });
  const result = await new AsaasCheckoutClient(fetchMock).reconcileCustomer({
   currentExternalId: "cus_stale",
   reference: "fmcc-buyer-123456",
   name: "Cliente Teste",
   cpfCnpj: "12345678909",
  });
  expect(result).toEqual({ customerId: "cus_created", source: "created" });
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls[3][1].method).toBe("POST");
 });

 it("blocks saved customer identity mismatch before payment issuance", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
   ok: true,
   status: 200,
   json: async () => ({
    id: "cus_saved",
    externalReference: "fmcc-buyer-123456",
    cpfCnpj: "99999999999",
   }),
  });
  await expect(new AsaasCheckoutClient(fetchMock).reconcileCustomer({
   currentExternalId: "cus_saved",
   reference: "fmcc-buyer-123456",
   name: "Cliente Teste",
   cpfCnpj: "12345678909",
  })).rejects.toThrow("identity_mismatch");
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });

 it("retrieves Pix QR code by GET only", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
   ok: true,
   json: async () => ({ encodedImage: "aGVsbG8=", payload: "000201" }),
  });
  const qr = await new AsaasCheckoutClient(fetchMock).pixCode("pay_example123");
  expect(qr.payload).toBe("000201");
  expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  expect(fetchMock.mock.calls[0][0]).toContain("/payments/pay_example123/pixQrCode");
 });

 it("rejects ambiguous provider response, without retrying POST", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
  await expect(new AsaasCheckoutClient(fetchMock).ensureCustomer({
   reference: "fmcc-buyer-123456",
   name: "Cliente Teste",
   cpfCnpj: "12345678909",
  })).rejects.toThrow("uncertain_response");
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });
});
