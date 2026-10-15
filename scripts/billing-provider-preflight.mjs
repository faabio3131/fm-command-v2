import { assertNoPreviousPayment } from "./billing-provider-duplicate-guard.mjs";

export async function preflightProviderInvoice(request, invoiceId) {
  if (typeof invoiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(invoiceId)) {
    throw new Error("billing.invoice_reference_invalid");
  }
  const result = await request("GET", "/payments?externalReference=" + encodeURIComponent(invoiceId));
  assertNoPreviousPayment(result);
}

export async function createSandboxChargeAfterPreflight(request, invoiceId, charge) {
  await preflightProviderInvoice(request, invoiceId);
  return request("POST", "/payments", { ...charge, externalReference: invoiceId });
}
