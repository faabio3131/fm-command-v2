import { describe, expect, it } from "vitest";
import { attributeGatewayPayment, validateBillingAttribution, type BillingAttribution, type GatewayPaymentNotice } from "../src/domain/billing/payment-attribution";

const binding: BillingAttribution = {
  tenantId: "fm", productId: "kordena", customerId: "cust-1",
  subscriptionId: "sub-1", invoiceId: "inv-1", gatewayAccountId: "asaas-test",
  environment: "sandbox", amountMinor: 9900, currency: "BRL",
};
const notice: GatewayPaymentNotice = {
  provider: "asaas", providerPaymentId: "pay-1", gatewayAccountId: "asaas-test",
  environment: "sandbox", invoiceId: "inv-1", amountMinor: 9900, currency: "BRL", eventId: "evt-1",
};

describe("central billing attribution", () => {
  it("preserves original tenant, SaaS and customer binding", () => {
    expect(attributeGatewayPayment(binding, notice)).toEqual(binding);
  });
  it("fails closed for unknown invoices", () => {
    expect(() => attributeGatewayPayment(null, notice)).toThrow("billing.invoice_not_found");
  });
  it("rejects crossover between gateway accounts", () => {
    expect(() => attributeGatewayPayment(binding, { ...notice, gatewayAccountId: "other" })).toThrow("billing.binding_mismatch");
  });
  it("rejects sandbox events against production bindings", () => {
    expect(() => attributeGatewayPayment(binding, { ...notice, environment: "production" })).toThrow("billing.binding_mismatch");
  });
  it("rejects an invoice belonging to another SaaS", () => {
    expect(() => attributeGatewayPayment(binding, { ...notice, invoiceId: "inv-iron" })).toThrow("billing.binding_mismatch");
  });
  it("rejects payment amount mismatch", () => {
    expect(() => attributeGatewayPayment(binding, { ...notice, amountMinor: 1 })).toThrow("billing.payment_amount_mismatch");
  });
  it("rejects missing or malformed commercial attribution", () => {
    expect(() => validateBillingAttribution({ ...binding, customerId: "" })).toThrow("billing.attribution_missing");
    expect(() => validateBillingAttribution({ ...binding, amountMinor: 12.5 })).toThrow("billing.amount_invalid");
  });
});
