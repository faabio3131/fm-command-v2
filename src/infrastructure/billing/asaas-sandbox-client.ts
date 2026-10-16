import { resolveGatewaySecret } from "./secret-resolver";

const BASE_URL = "https://api-sandbox.asaas.com/v3";
export class AsaasSandboxError extends Error {
  constructor(readonly code: string, readonly httpStatus?: number) {
    super(code);
    this.name = "AsaasSandboxError";
  }
}
export interface SandboxCustomerInput { name: string; email: string; cpfCnpj: string; externalReference: string }
export interface SandboxChargeInput { customer: string; value: number; dueDate: string; externalReference: string; description: string }
export interface AsaasCustomer { id: string }
export interface AsaasCharge { id: string; status: string; value: number; externalReference?: string }

/**
 * Sandbox-only adapter. No production URL or transfers/withdrawals are exposed.
 * Caller must bind every remote charge to a persisted canonical invoice first.
 */
export class AsaasSandboxClient {
  constructor(private readonly transport: typeof fetch = fetch) {}
  private async request<T>(method: "GET" | "POST", endpoint: string, body?: object): Promise<T> {
    if (!/^\/(customers|payments|sandbox\/payment\/[^/]+\/confirm)(?:\/[^/?]+)?$/.test(endpoint) || endpoint.includes(".."))
      throw new AsaasSandboxError("billing.asaas_endpoint_denied");
    const token = resolveGatewaySecret({provider:"asaas",environment:"sandbox",secretRef:"env://FMCC_ASAAS_SANDBOX_API_KEY"});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.transport(BASE_URL + endpoint, {
        method, signal: controller.signal,
        headers: { access_token: token, accept: "application/json", "content-type": "application/json", "user-agent": "FMCommand-Billing-Sandbox/1.0" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error", cache: "no-store",
      });
      if (!response.ok) throw new AsaasSandboxError("billing.asaas_http_error", response.status);
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new AsaasSandboxError("billing.asaas_invalid_response");
      return data as T;
    } catch (error) {
      if (error instanceof AsaasSandboxError) throw error;
      throw new AsaasSandboxError("billing.asaas_transport_failure");
    } finally { clearTimeout(timeout); }
  }
  async createCustomer(input: SandboxCustomerInput): Promise<AsaasCustomer> {
    if (!input.name.trim() || !input.email.trim() || !input.cpfCnpj.trim() || !input.externalReference.trim())
      throw new AsaasSandboxError("billing.asaas_customer_invalid");
    const response = await this.request<AsaasCustomer>("POST", "/customers", input);
    if (typeof response.id !== "string" || !response.id) throw new AsaasSandboxError("billing.asaas_customer_response_invalid");
    return response;
  }
  async createPixCharge(input: SandboxChargeInput): Promise<AsaasCharge> {
    if (!input.customer || !input.externalReference || !input.description || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ||
        !Number.isFinite(input.value) || input.value <= 0 || Math.abs(Math.round(input.value * 100) - input.value * 100) > 1e-7)
      throw new AsaasSandboxError("billing.asaas_charge_invalid");
    const response = await this.request<AsaasCharge>("POST", "/payments", { ...input, billingType:"PIX" });
    if (typeof response.id !== "string" || !response.id || response.externalReference !== input.externalReference)
      throw new AsaasSandboxError("billing.asaas_charge_response_invalid");
    return response;
  }
  async getCharge(paymentId: string): Promise<AsaasCharge> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(paymentId)) throw new AsaasSandboxError("billing.asaas_id_invalid");
    return this.request<AsaasCharge>("GET", "/payments/" + paymentId);
  }
  async confirmTestPayment(paymentId: string): Promise<AsaasCharge> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(paymentId)) throw new AsaasSandboxError("billing.asaas_id_invalid");
    return this.request<AsaasCharge>("POST", "/sandbox/payment/" + paymentId + "/confirm");
  }
}
