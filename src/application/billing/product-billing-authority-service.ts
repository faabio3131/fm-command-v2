import { createHash } from "node:crypto";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

export type BillingPlanInterval = "monthly" | "yearly";
export type BillingPlanStatus = "active" | "inactive";

export interface BillingProductPlanView {
  readonly id: string;
  readonly productId: string;
  readonly planCode: string;
  readonly name: string;
  readonly interval: BillingPlanInterval;
  readonly amountMinor: number;
  readonly currency: "BRL";
  readonly status: BillingPlanStatus;
}

export interface BillingProductRouteView {
  readonly productId: string;
  readonly gatewayAccountId: string;
  readonly provider: string;
  readonly environment: "sandbox" | "production";
  readonly status: "enabled" | "disabled";
}

export interface BillingPreparationView {
  readonly productId: string;
  readonly externalTenantId: string;
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly planCode: string;
  readonly amountMinor: number;
  readonly currency: "BRL";
  readonly gatewayAccountId: string;
  readonly gatewayProvider: string;
  readonly gatewayEnvironment: "sandbox" | "production";
  readonly invoiceStatus: string;
  readonly idempotentReplay: boolean;
}

export interface ProductBillingAuthorityRepository {
  listPlans(tenantId: string, productId: string): Promise<readonly BillingProductPlanView[]>;
  upsertPlan(tenantId: string, productId: string, input: {
    planCode: string;
    name: string;
    interval: BillingPlanInterval;
    amountMinor: number;
    status: BillingPlanStatus;
  }): Promise<BillingProductPlanView>;
  getRoute(tenantId: string, productId: string): Promise<BillingProductRouteView | null>;
  configureRoute(tenantId: string, productId: string, gatewayAccountId: string): Promise<BillingProductRouteView>;
  prepareSubscriptionInvoice(input: {
    tenantId: string;
    productId: string;
    externalTenantId: string;
    planCode: string;
    idempotencyKey: string;
    payloadHash: string;
  }): Promise<BillingPreparationView>;
}

export class BillingProductInputError extends Error {
  constructor(message = "billing.product_input_invalid") { super(message); }
}

const CODE = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const EXTERNAL_TENANT = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function hashPreparation(productId: string, externalTenantId: string, planCode: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ productId, externalTenantId, planCode }))
    .digest("hex");
}

export class ProductBillingAuthorityService {
  constructor(private readonly repository: ProductBillingAuthorityRepository) {}

  async listPlans(context: TenantContext, productId: string) {
    requirePermission(context, "billing:read");
    return this.repository.listPlans(context.tenantId, productId);
  }

  async upsertPlan(context: TenantContext, productId: string, input: {
    planCode: string;
    name: string;
    interval: BillingPlanInterval;
    amountMinor: number;
    status?: BillingPlanStatus;
  }) {
    requirePermission(context, "billing:write");
    const planCode = input.planCode.trim().toUpperCase();
    const name = input.name.trim();
    if (!CODE.test(planCode) || name.length < 2 || name.length > 120)
      throw new BillingProductInputError();
    if (input.interval !== "monthly" && input.interval !== "yearly")
      throw new BillingProductInputError();
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
      throw new BillingProductInputError();
    const status = input.status ?? "active";
    if (status !== "active" && status !== "inactive")
      throw new BillingProductInputError();
    return this.repository.upsertPlan(context.tenantId, productId, {
      planCode, name, interval: input.interval, amountMinor: input.amountMinor, status,
    });
  }

  async getRoute(context: TenantContext, productId: string) {
    requirePermission(context, "billing:read");
    return this.repository.getRoute(context.tenantId, productId);
  }

  async configureRoute(context: TenantContext, productId: string, gatewayAccountId: string) {
    requirePermission(context, "billing:write");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(gatewayAccountId))
      throw new BillingProductInputError();
    return this.repository.configureRoute(context.tenantId, productId, gatewayAccountId);
  }

  async prepareSubscriptionInvoice(context: TenantContext, productId: string, input: {
    externalTenantId: string;
    planCode: string;
    idempotencyKey: string;
  }) {
    requirePermission(context, "billing:write");
    const externalTenantId = input.externalTenantId.trim();
    const planCode = input.planCode.trim().toUpperCase();
    const idempotencyKey = input.idempotencyKey.trim();
    if (!EXTERNAL_TENANT.test(externalTenantId) || !CODE.test(planCode) || !IDEMPOTENCY.test(idempotencyKey))
      throw new BillingProductInputError();

    return this.repository.prepareSubscriptionInvoice({
      tenantId: context.tenantId,
      productId,
      externalTenantId,
      planCode,
      idempotencyKey,
      payloadHash: hashPreparation(productId, externalTenantId, planCode),
    });
  }
}
