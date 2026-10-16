/** Immutable commercial attribution decided by FM Command before gateway checkout. */
export interface BillingAttribution {
  readonly tenantId: string;
  readonly productId: string;
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly gatewayAccountId: string;
  readonly environment: "sandbox" | "production";
  readonly amountMinor: number;
  readonly currency: "BRL";
}

export interface GatewayPaymentNotice {
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly gatewayAccountId: string;
  readonly environment: "sandbox" | "production";
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly eventId: string;
}

export class BillingAttributionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BillingAttributionError";
  }
}

const isId = (value: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 256;

export function validateBillingAttribution(input: BillingAttribution): BillingAttribution {
  for (const value of [input.tenantId, input.productId, input.customerId, input.subscriptionId, input.invoiceId, input.gatewayAccountId]) {
    if (!isId(value)) throw new BillingAttributionError("billing.attribution_missing");
  }
  if (!["sandbox", "production"].includes(input.environment)) throw new BillingAttributionError("billing.environment_invalid");
  if (input.currency !== "BRL" || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1)
    throw new BillingAttributionError("billing.amount_invalid");
  return Object.freeze({ ...input });
}

/**
 * Only a previously persisted invoice binding is authoritative.
 * Gateway metadata, webhook payloads and SaaS-supplied customer/product IDs
 * never overwrite the original binding. Authentication and signature verification
 * MUST occur before this function is called.
 */
export function attributeGatewayPayment(
  persisted: BillingAttribution | null,
  notice: GatewayPaymentNotice,
): BillingAttribution {
  if (!persisted) throw new BillingAttributionError("billing.invoice_not_found");
  const binding = validateBillingAttribution(persisted);
  if (!isId(notice.providerPaymentId) || !isId(notice.eventId) || !isId(notice.provider))
    throw new BillingAttributionError("billing.gateway_reference_invalid");
  if (binding.invoiceId !== notice.invoiceId ||
      binding.gatewayAccountId !== notice.gatewayAccountId ||
      binding.environment !== notice.environment)
    throw new BillingAttributionError("billing.binding_mismatch");
  if (binding.amountMinor !== notice.amountMinor || binding.currency !== notice.currency)
    throw new BillingAttributionError("billing.payment_amount_mismatch");
  return binding;
}
