import { ASAAS_PRODUCTION_SECRET_REF, resolveGatewaySecret } from "./secret-resolver";
import { ironAsaasInvoiceReference } from "./asaas-iron-payment-readonly-client";

export interface IssuedIronPayment {
  id: string;
  customer: string;
  externalReference: string;
  value: number;
  billingType: "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";
  status: string;
  invoiceUrl?: string;
}

export class AsaasIronIssueError extends Error {
  constructor(readonly code: string, readonly ambiguous = false) { super(code); }
}

export class AsaasIronIssuerClient {
  constructor(private readonly transport: typeof fetch = fetch) {}

  private async request(method: "GET" | "POST", path: string, payload?: object): Promise<unknown> {
    const secret = resolveGatewaySecret({
      provider: "asaas", environment: "production", secretRef: ASAAS_PRODUCTION_SECRET_REF,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.transport("https://api.asaas.com/v3" + path, {
        method,
        headers: {
          access_token: secret, accept: "application/json",
          "content-type": "application/json", "user-agent": "FMCommand-IRON-Issuer/1.0",
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        redirect: "error", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) {
        // A failed POST is ambiguous without a verified provider read.
        throw new AsaasIronIssueError(
          "billing.iron_asaas_http_" + response.status, method === "POST",
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof AsaasIronIssueError) throw error;
      throw new AsaasIronIssueError("billing.iron_asaas_transport_uncertain", method === "POST");
    } finally {
      clearTimeout(timer);
    }
  }

  /** A payment link is untrusted provider data; never reflect an arbitrary URL. */
  private trustedHostedInvoiceUrl(input: unknown): boolean {
    if (typeof input !== "string") return false;
    try {
      const u = new URL(input);
      return u.protocol === "https:" &&
        (u.hostname === "www.asaas.com" || u.hostname === "asaas.com") &&
        !u.username && !u.password && !u.port;
    } catch { return false; }
  }

  validatePayment(raw: unknown, input: {
    invoiceId: string; customerId: string; amountMinor: number;
  }): IssuedIronPayment {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AsaasIronIssueError("billing.iron_asaas_payment_contract_invalid");
    }
    const p = raw as Record<string, unknown>;
    const reference = ironAsaasInvoiceReference(input.invoiceId);
    if (typeof p.id !== "string" || !/^pay_[A-Za-z0-9_-]{1,128}$/.test(p.id) ||
        p.customer !== input.customerId || p.externalReference !== reference ||
        !["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"].includes(String(p.billingType)) ||
        typeof p.value !== "number" ||
        !Number.isFinite(p.value) || Math.abs(p.value * 100 - input.amountMinor) > 0.001 ||
        typeof p.status !== "string") {
      throw new AsaasIronIssueError("billing.iron_asaas_payment_binding_mismatch");
    }
    return {
      id: p.id, customer: input.customerId, externalReference: reference,
      value: p.value, billingType: p.billingType as IssuedIronPayment["billingType"], status: p.status,
      ...(this.trustedHostedInvoiceUrl(p.invoiceUrl) ?
        { invoiceUrl: p.invoiceUrl as string } : {}),
    };
  }

  async findUnique(input: { invoiceId: string; customerId: string; amountMinor: number }): Promise<IssuedIronPayment | null> {
    const ref = ironAsaasInvoiceReference(input.invoiceId);
    const raw = await this.request("GET", "/payments?externalReference=" + encodeURIComponent(ref) + "&limit=100");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AsaasIronIssueError("billing.iron_asaas_preflight_invalid");
    }
    const list = raw as Record<string, unknown>;
    if (!Array.isArray(list.data) || list.hasMore !== false || list.data.length > 1) {
      throw new AsaasIronIssueError("billing.iron_asaas_preflight_ambiguous");
    }
    if (list.data.length === 0) return null;
    return this.validatePayment(list.data[0],input);
  }

  async createOnce(input: {
    invoiceId: string; customerId: string; amountMinor: number; dueDate: string;
  }): Promise<IssuedIronPayment> {
    const today = new Date();
    const todayIso = today.toISOString().slice(0,10);
    const max = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ||
        input.dueDate < todayIso || input.dueDate > max ||
        !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new AsaasIronIssueError("billing.iron_asaas_due_date_or_amount_invalid");
    }
    const payment = await this.request("POST", "/payments", {
      // Hosted Asaas invoice lets the payer select PIX, CREDIT_CARD or BOLETO
      // when enabled on the provider account. No PAN/CVV enters FM Command.
      customer: input.customerId, billingType: "UNDEFINED",
      value: input.amountMinor / 100, dueDate: input.dueDate,
      description: "IRON FIT CORE - Licenca SaaS FM Tecnologia",
      externalReference: ironAsaasInvoiceReference(input.invoiceId),
    });
    return this.validatePayment(payment,input);
  }
}
