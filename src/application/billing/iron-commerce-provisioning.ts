import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { CaktoIronProductBilling } from "@/application/billing/cakto-iron-product-billing";
import { assertIronCommercialPlanInterval } from "@/application/billing/iron-commercial-plan-identity";
import { CaktoPaymentProvider } from "@/infrastructure/subscription/cakto-payment-provider";
import { PostgresProductBillingAuthorityRepository } from "@/infrastructure/billing/postgres-product-billing-authority-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const IDEM = /^[a-zA-Z0-9._:-]{8,127}$/;

export function verifyIronCommerceBearer(authorization: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const received = authorization.slice(7);
  if (received.length < 32 || received.length > 255) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

export interface IronCommerceRequest {
  gymId: string;
  expectedSubscriptionId: string;
  planCode: string;
  idempotencyKey: string;
}
export class IronCommerceProvisioning {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly transport: typeof fetch = fetch,
    private readonly provider = new PostgresProductBillingAuthorityRepository(),
  ) {}

  private config() {
    const productId = this.env.FMCC_IRON_PRODUCT_ID ?? "";
    const tenantId = this.env.FMCC_IRON_BILLING_TENANT_ID ?? "";
    const base = this.env.FMCC_IRON_CONTROL_PLANE_URL ?? "";
    const token = this.env.FMCC_IRON_CONTROL_PLANE_TOKEN ?? "";
    if (!UUID.test(productId) || !/^[A-Za-z0-9._:-]{3,128}$/.test(tenantId) || token.length < 32)
      throw new Error("iron.commerce_configuration_missing");
    const url = new URL(base);
    if (url.protocol !== "https:" || url.hostname !== "api.ironfitcore.com.br" ||
      url.pathname !== "/api/v1/control-plane/fmcc" || url.search || url.hash ||
      url.username || url.password) throw new Error("iron.commerce_control_plane_invalid");
    return { productId, tenantId, base: url.toString().replace(/\/$/, ""), token };
  }

  private async fetchControl(url: string, token: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.transport(url, {
        method: "GET", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { authorization: "Bearer " + token, "x-correlation-id": "checkout-preflight-" + randomUUID() },
      });
      if (!response.ok) throw new Error("iron.commerce_control_plane_unavailable");
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  /**
   * Read-only IRON authority for Command's academy trial portfolio.
   * Reuses the existing protected S2S transport, independent of Cakto offers.
   * The authenticated FM company scope must match the configured owner tenant.
   */
  async readTrialSnapshot(companyTenantId: string, scopedProductId?: string): Promise<unknown | null> {
    if (!companyTenantId || companyTenantId !== this.env.FMCC_IRON_BILLING_TENANT_ID) return null;
    const conf = this.config();
    if (scopedProductId && scopedProductId !== conf.productId) return null;
    return this.fetchControl(conf.base + "/snapshot", conf.token);
  }

  async offers(): Promise<Array<{planCode: string; name: string; interval: "monthly" | "yearly"; amountMinor: number; currency: "BRL"}>> {
    const conf = this.config();
    const route = await this.provider.getRoute(conf.tenantId, conf.productId);
    if (!route || route.status !== "enabled" || route.provider !== "cakto" ||
      route.environment !== "production") return [];
    const catalog = await this.fetchControl(conf.base + "/plan-versions", conf.token) as { plans?: unknown };
    if (!Array.isArray(catalog?.plans)) throw new Error("iron.commerce_plan_catalog_invalid");
    const published = new Set(catalog.plans
      .filter((v: unknown) => v && typeof v === "object" && !Array.isArray(v))
      .map((v: unknown) => (v as { plan_code?: unknown }).plan_code)
      .filter((v: unknown): v is string => typeof v === "string"));
    // Construction validates the Cakto seller's hosted offer URLs and IDs at startup.
    const provider = new CaktoPaymentProvider(this.env);
    const plans = await this.provider.listPlans(conf.tenantId, conf.productId);
    return plans.filter(p => {
      if (p.status !== "active") return false;
      let canonical: string;
      try { canonical = assertIronCommercialPlanInterval(p.planCode, p.interval); }
      catch { return false; }
      return published.has(canonical) &&
        provider.hasExactlyOneOffer(p.amountMinor, p.interval === "monthly" ? "month" : "year");
    }).map(p => ({ planCode:p.planCode, name:p.name, interval:p.interval,
      amountMinor:p.amountMinor, currency: "BRL" as const }));
  }

  async prepare(input: IronCommerceRequest): Promise<{ checkoutUrl: string; invoiceId: string; productCode: "IRON_FIT_CORE" }> {
    if (!UUID.test(input.gymId) || !UUID.test(input.expectedSubscriptionId) ||
        !CODE.test(input.planCode) || !IDEM.test(input.idempotencyKey))
      throw new Error("iron.commerce_input_invalid");
    // Do not create a pending invoice while sales are explicitly disabled.
    if (this.env.FMCC_IRON_COMMERCIAL_SALES_ENABLED !== "true")
      throw new Error("iron.commerce_sales_disabled");
    const conf = this.config();
    const [snapshot, planList] = await Promise.all([
      this.fetchControl(conf.base + "/snapshot", conf.token),
      this.fetchControl(conf.base + "/plan-versions", conf.token),
    ]);
    if (!snapshot || typeof snapshot !== "object" || !planList || typeof planList !== "object")
      throw new Error("iron.commerce_control_plane_invalid_response");
    const subscriptions = (snapshot as { subscriptions?: unknown }).subscriptions;
    const plans = (planList as { plans?: unknown }).plans;
    if (!Array.isArray(subscriptions) || !Array.isArray(plans))
      throw new Error("iron.commerce_control_plane_invalid_response");
    const owned = subscriptions.filter((s: unknown) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) return false;
      const v = s as Record<string, unknown>;
      return v.tenant_id === input.gymId && v.external_id === input.expectedSubscriptionId &&
        v.status === "ACTIVE";
    });
    if (owned.length !== 1) throw new Error("iron.commerce_subscription_invalid");
    // The billing SKU owns price and billing interval; the IRON catalog only owns
    // the canonical entitlement tier. Never send the SKU as an IRON plan code.
    const billingPlans = (await this.provider.listPlans(conf.tenantId, conf.productId))
      .filter(p => p.planCode === input.planCode && p.status === "active");
    if (billingPlans.length !== 1) throw new Error("iron.commerce_billing_plan_not_available");
    const canonical = assertIronCommercialPlanInterval(input.planCode, billingPlans[0].interval);
    const published = plans.some((s: unknown) => s && typeof s === "object" && !Array.isArray(s) &&
      (s as Record<string, unknown>).plan_code === canonical);
    if (!published) throw new Error("iron.commerce_plan_not_published");
    const hash = createHash("sha256").update(JSON.stringify({
      productId: conf.productId, externalTenantId: input.gymId, planCode: input.planCode,
    })).digest("hex");
    const invoice = await this.provider.prepareSubscriptionInvoice({
      tenantId: conf.tenantId, productId: conf.productId,
      externalTenantId: input.gymId, planCode: input.planCode,
      idempotencyKey: input.idempotencyKey, payloadHash: hash,
    });
    if (invoice.gatewayProvider !== "cakto" || invoice.gatewayEnvironment !== "production")
      throw new Error("iron.commerce_provider_not_live");
    const checkoutUrl = await new CaktoIronProductBilling(this.env).checkoutUrl(invoice.invoiceId);
    return { checkoutUrl, invoiceId: invoice.invoiceId, productCode: "IRON_FIT_CORE" };
  }
}
