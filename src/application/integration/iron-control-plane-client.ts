import { randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shared, read-only S2S connection to the canonical IRON FMCC control plane.
 * IRON remains the authority for academies, trials and entitlements.
 * The Command billing and customer views reuse this transport without pulling
 * Cakto or PostgreSQL modules into read-only application code.
 */
export class IronControlPlaneClient {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly transport: typeof fetch = fetch,
  ) {}

  config() {
    const productId = this.env.FMCC_IRON_PRODUCT_ID ?? "";
    const tenantId = this.env.FMCC_IRON_BILLING_TENANT_ID ?? "";
    const base = this.env.FMCC_IRON_CONTROL_PLANE_URL ?? "";
    const token = this.env.FMCC_IRON_CONTROL_PLANE_TOKEN ?? "";
    if (!UUID.test(productId) || !/^[A-Za-z0-9._:-]{3,128}$/.test(tenantId) || token.length < 32) {
      throw new Error("iron.commerce_configuration_missing");
    }
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new Error("iron.commerce_control_plane_invalid");
    }
    if (url.protocol !== "https:" || url.hostname !== "api.ironfitcore.com.br" ||
        url.port || url.pathname !== "/api/v1/control-plane/fmcc" || url.search || url.hash ||
        url.username || url.password) throw new Error("iron.commerce_control_plane_invalid");
    return { productId, tenantId, base: url.toString().replace(/\/$/, ""), token };
  }

  async fetchControl(url: string, token: string, purpose = "checkout-preflight"): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.transport(url, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          authorization: "Bearer " + token,
          "x-correlation-id": purpose + "-" + randomUUID(),
        },
      });
      if (!response.ok) throw new Error("iron.commerce_control_plane_unavailable");
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async readTrialSnapshot(companyTenantId: string, scopedProductId?: string): Promise<unknown | null> {
    if (!companyTenantId || companyTenantId !== this.env.FMCC_IRON_BILLING_TENANT_ID) return null;
    const conf = this.config();
    if (scopedProductId && scopedProductId !== conf.productId) return null;
    return this.fetchControl(conf.base + "/snapshot", conf.token, "trial-portfolio");
  }
}
