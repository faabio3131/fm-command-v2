import { ASAAS_PRODUCTION_SECRET_REF, resolveGatewaySecret } from "./secret-resolver";

export type VerifiedAsaasPaymentState = "RECEIVED" | "REFUNDED";

export interface VerifiedAsaasPayment {
  readonly id: string;
  readonly customer: string;
  readonly externalReference: string;
  readonly valueMinor: number;
  readonly billingType: "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";
  readonly status: VerifiedAsaasPaymentState;
}

/**
 * The externalReference is set by the future generic IRON charge issuer.
 * A payment from the old fixed Kordena pilot is never a valid IRON proof.
 */
export function ironAsaasInvoiceReference(invoiceId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
    throw new Error("billing.iron_invoice_id_invalid");
  }
  return "fmcc-iron-" + invoiceId.toLowerCase();
}

export class AsaasIronPaymentVerificationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AsaasIronPaymentVerificationError"; }
}

const PROVIDER_PAYMENT_ID = /^pay_[A-Za-z0-9_-]{1,128}$/;

/** No payment creation, refund issuance, or blind webhook state trust. GET only. */
export class AsaasIronPaymentReadOnlyClient {
  constructor(private readonly transport: typeof fetch = fetch) {}

  async verify(input: {
    paymentId: string; customerId: string; invoiceId: string; amountMinor: number;
  }): Promise<VerifiedAsaasPayment> {
    if (!PROVIDER_PAYMENT_ID.test(input.paymentId) ||
        !/^cus_[A-Za-z0-9_-]{1,128}$/.test(input.customerId) ||
        !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new AsaasIronPaymentVerificationError("billing.iron_payment_binding_invalid");
    }
    const reference = ironAsaasInvoiceReference(input.invoiceId);
    const key = resolveGatewaySecret({
      provider: "asaas", environment: "production", secretRef: ASAAS_PRODUCTION_SECRET_REF,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await this.transport(
        "https://api.asaas.com/v3/payments/" + encodeURIComponent(input.paymentId), {
          method: "GET",
          headers: {
            access_token: key, accept: "application/json",
            "user-agent": "FMCommand-IRON-ReadOnly/1.0",
          },
          redirect: "error", cache: "no-store", signal: controller.signal,
        });
    } catch {
      throw new AsaasIronPaymentVerificationError("billing.iron_asaas_get_unavailable");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new AsaasIronPaymentVerificationError("billing.iron_asaas_http_" + response.status);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new AsaasIronPaymentVerificationError("billing.iron_asaas_response_invalid");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new AsaasIronPaymentVerificationError("billing.iron_asaas_response_invalid");
    }
    const p = data as Record<string, unknown>;
    if (p.id !== input.paymentId || p.customer !== input.customerId ||
        p.externalReference !== reference ||
        typeof p.value !== "number" || !Number.isFinite(p.value) ||
        Math.abs(p.value * 100 - input.amountMinor) > 0.001 ||
        !["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"].includes(String(p.billingType))) {
      throw new AsaasIronPaymentVerificationError("billing.iron_asaas_payment_mismatch");
    }
    // RECEIVED is available funds; CONFIRMED is deliberately not accepted.
    // REFUNDED represents an actual reversal. Partial refunds and disputed
    // chargebacks require separate human-approved commercial policy.
    if (p.status !== "RECEIVED" && p.status !== "REFUNDED") {
      throw new AsaasIronPaymentVerificationError("billing.iron_asaas_state_requires_review");
    }
    return {
      id: input.paymentId, customer: input.customerId, externalReference: reference,
      valueMinor: input.amountMinor,
      billingType: p.billingType as VerifiedAsaasPayment["billingType"],
      status: p.status,
    };
  }
}
