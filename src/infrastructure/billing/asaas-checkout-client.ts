import { ASAAS_PRODUCTION_SECRET_REF, resolveGatewaySecret } from "./secret-resolver";

const BASE = "https://api.asaas.com/v3";
export class AsaasCheckoutTransportError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AsaasCheckoutTransportError"; }
}
export type AsaasCustomer = {
  id: string;
  externalReference?: string;
  cpfCnpj?: string;
};
export type AsaasPixCode = { encodedImage: string; payload: string; expirationDate?: string };
type Transport = typeof fetch;

/**
 * Provider boundary, not an exposed checkout route. Secrets remain server-side.
 * Never auto-retry ambiguous POSTs; caller must reconcile by externalReference.
 */
export class AsaasCheckoutClient {
  constructor(private readonly transport: Transport = fetch) {}

  private async request<T>(method: "GET" | "POST", path: string, payload?: object): Promise<T> {
    const key = resolveGatewaySecret({
      provider: "asaas",
      environment: "production",
      secretRef: ASAAS_PRODUCTION_SECRET_REF,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await this.transport(BASE + path, {
        method,
        headers: {
          access_token: key,
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "FMCommand/1.0",
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      if (!res.ok) throw new AsaasCheckoutTransportError("billing.asaas_http_" + res.status);
      return await res.json() as T;
    } catch (error) {
      if (error instanceof AsaasCheckoutTransportError) throw error;
      throw new AsaasCheckoutTransportError("billing.asaas_uncertain_response");
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateCustomerInput(input: {
    reference: string;
    name: string;
    cpfCnpj: string;
  }): void {
    if (!/^fmcc-[a-z0-9-]{6,100}$/.test(input.reference))
      throw new AsaasCheckoutTransportError("billing.customer_reference_invalid");
    if (input.name.trim().length < 3 || !/^\d{11}(?:\d{3})?$/.test(input.cpfCnpj))
      throw new AsaasCheckoutTransportError("billing.customer_data_invalid");
  }

  async customerById(customerId: string): Promise<AsaasCustomer | null> {
    if (!/^cus_[A-Za-z0-9_-]+$/.test(customerId))
      return null;
    try {
      const customer = await this.request<AsaasCustomer>(
        "GET",
        "/customers/" + encodeURIComponent(customerId),
      );
      if (!customer || customer.id !== customerId)
        throw new AsaasCheckoutTransportError("billing.customer_lookup_invalid");
      return customer;
    } catch (error) {
      if (error instanceof AsaasCheckoutTransportError && error.code === "billing.asaas_http_404")
        return null;
      throw error;
    }
  }

  async findCustomers(reference: string): Promise<AsaasCustomer[]> {
    if (!/^fmcc-[a-z0-9-]{6,100}$/.test(reference))
      throw new AsaasCheckoutTransportError("billing.customer_reference_invalid");
    const found = await this.request<{ data?: AsaasCustomer[]; hasMore?: boolean }>(
      "GET",
      "/customers?externalReference=" + encodeURIComponent(reference),
    );
    // Never conclude uniqueness from a truncated provider page.
    if (!Array.isArray(found.data) || found.hasMore === true)
      throw new AsaasCheckoutTransportError("billing.customer_lookup_invalid");
    return found.data.filter(
      c => c.externalReference === reference && /^cus_[\w-]+$/.test(c.id),
    );
  }

  async findCustomersByDocument(cpfCnpj: string): Promise<AsaasCustomer[]> {
    if (!/^\d{11}(?:\d{3})?$/.test(cpfCnpj))
      throw new AsaasCheckoutTransportError("billing.customer_data_invalid");
    const found = await this.request<{ data?: AsaasCustomer[]; hasMore?: boolean }>(
      "GET",
      "/customers?cpfCnpj=" + encodeURIComponent(cpfCnpj),
    );
    // A truncated search cannot certify that the document is unused.
    if (!Array.isArray(found.data) || found.hasMore === true)
      throw new AsaasCheckoutTransportError("billing.customer_lookup_invalid");
    return found.data.filter(customer => {
      if (!/^cus_[\w-]+$/.test(customer.id)) return false;
      const document = customer.cpfCnpj?.replace(/\D/g, "");
      return !document || document === cpfCnpj;
    });
  }

  private async createCustomer(input: {
    reference: string;
    name: string;
    cpfCnpj: string;
    email?: string;
  }): Promise<string> {
    const created = await this.request<AsaasCustomer>("POST", "/customers", {
      name: input.name.trim(),
      cpfCnpj: input.cpfCnpj,
      ...(input.email ? { email: input.email.trim() } : {}),
      externalReference: input.reference,
      notificationDisabled: true,
    });
    if (!/^cus_[\w-]+$/.test(created.id) || created.externalReference !== input.reference)
      throw new AsaasCheckoutTransportError("billing.customer_create_unconfirmed");
    return created.id;
  }

  /**
   * One network POST, never an automatic retry. The caller MUST persist a
   * canonical one-shot enrollment claim before calling this method.
   */
  async createIronPayerOnce(input: {
    reference: string; name: string; cpfCnpj: string; email?: string;
  }): Promise<string> {
    if (!/^fmcc-iron-customer-[0-9a-f-]{36}$/i.test(input.reference)) {
      throw new AsaasCheckoutTransportError("billing.iron_payer_reference_invalid");
    }
    this.validateCustomerInput(input);
    return this.createCustomer(input);
  }

  async ensureCustomer(input: {
    reference: string;
    name: string;
    cpfCnpj: string;
    email?: string;
  }): Promise<string> {
    this.validateCustomerInput(input);
    const existing = await this.findCustomers(input.reference);
    if (existing.length > 1)
      throw new AsaasCheckoutTransportError("billing.customer_duplicate_requires_review");
    if (existing.length === 1) {
      const cpfCnpj = existing[0].cpfCnpj?.replace(/\D/g, "");
      if (cpfCnpj && cpfCnpj !== input.cpfCnpj)
        throw new AsaasCheckoutTransportError("billing.customer_identity_mismatch");
      return existing[0].id;
    }
    return this.createCustomer(input);
  }

  async reconcileCustomer(input: {
    currentExternalId: string;
    reference: string;
    name: string;
    cpfCnpj: string;
    email?: string;
  }): Promise<{ customerId: string; source: "saved" | "reference" | "document" | "created" }> {
    this.validateCustomerInput(input);

    const saved = await this.customerById(input.currentExternalId);
    if (saved) {
      const savedCpfCnpj = saved.cpfCnpj?.replace(/\D/g, "");
      if (savedCpfCnpj && savedCpfCnpj !== input.cpfCnpj)
        throw new AsaasCheckoutTransportError("billing.customer_identity_mismatch");
      if (saved.externalReference === input.reference || savedCpfCnpj === input.cpfCnpj)
        return { customerId: saved.id, source: "saved" };
    }

    const matches = await this.findCustomers(input.reference);
    if (matches.length > 1)
      throw new AsaasCheckoutTransportError("billing.customer_duplicate_requires_review");
    if (matches.length === 1) {
      const matchedCpfCnpj = matches[0].cpfCnpj?.replace(/\D/g, "");
      if (matchedCpfCnpj && matchedCpfCnpj !== input.cpfCnpj)
        throw new AsaasCheckoutTransportError("billing.customer_identity_mismatch");
      return { customerId: matches[0].id, source: "reference" };
    }

    const documentMatches = await this.findCustomersByDocument(input.cpfCnpj);
    if (documentMatches.length > 1)
      throw new AsaasCheckoutTransportError("billing.customer_duplicate_requires_review");
    if (documentMatches.length === 1)
      return { customerId: documentMatches[0].id, source: "document" };

    const customerId = await this.createCustomer(input);
    return { customerId, source: "created" };
  }

  async pixCode(paymentId: string): Promise<AsaasPixCode> {
    if (!/^pay_[\w-]+$/.test(paymentId))
      throw new AsaasCheckoutTransportError("billing.payment_id_invalid");
    const data = await this.request<AsaasPixCode>(
      "GET",
      "/payments/" + encodeURIComponent(paymentId) + "/pixQrCode",
    );
    if (!data.payload || !data.encodedImage || !/^[a-zA-Z0-9+/=]+$/.test(data.encodedImage))
      throw new AsaasCheckoutTransportError("billing.pix_payload_invalid");
    return data;
  }
}
