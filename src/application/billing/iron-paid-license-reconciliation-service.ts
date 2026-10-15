import { FMCC_IRON_PRODUCT_SLUG } from "@/domain/billing/iron-product-identity";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import { resolveIronPlanMapping } from "@/domain/billing/iron-versioned-plan-mapping";
import type { SourceDefinition } from "@/domain/integration/contracts";
import {
  IRON_COMMERCIAL_SECRET_REF,
  IRON_COMMERCIAL_SOURCE_TYPE,
  IronCommercialConnector,
} from "@/infrastructure/integration/iron-commercial-connector";

export interface VerifiedIronPayment {
  readonly tenantId: string;
  readonly productId: string;
  readonly invoiceId: string;
  readonly invoiceCreatedAt: string;
  readonly externalTenantId: string;
  readonly planCode: string;
  readonly amountMinor: number;
  readonly paymentId: string;
  readonly invoiceStatus: string;
  readonly paymentStatus: string;
  readonly gatewayEnvironment: string;
  readonly productSlug: string;
}

export interface PaidIronInvoiceRepository {
  findVerifiedProductionPayment(
    tenantId: string, productId: string, invoiceId: string,
  ): Promise<VerifiedIronPayment | null>;
}

type IronSubscriptionRow = {
  external_id: string;
  tenant_id: string;
  plan_code: string;
  plan_version: number;
  status: string;
  effective_until?: string | null;
};

function ironSubscription(value: unknown): IronSubscriptionRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.external_id !== "string" || typeof row.tenant_id !== "string" ||
      typeof row.plan_code !== "string" || typeof row.status !== "string" ||
      !Number.isSafeInteger(row.plan_version) || (row.plan_version as number) < 1) return null;
  if (row.effective_until !== null && row.effective_until !== undefined &&
      typeof row.effective_until !== "string") return null;
  return row as IronSubscriptionRow;
}

/**
 * D11 controlled payment-to-license reconciliation. The recipient tenant and
 * payment state always originate from Command's persisted, provider-reconciled
 * invoice. Neither a browser request nor an external webhook chooses a license.
 *
 * Reconciliation is manually operator-triggered until the certified
 * production payment event/outbox is available. This class does not itself
 * assert gateway confirmation or manufacture missing plan mappings.
 */
export class IronPaidLicenseReconciliationService {
  constructor(
    private readonly paidInvoices: PaidIronInvoiceRepository,
    private readonly connector: Pick<IronCommercialConnector, "snapshot" | "subscriptionCommand">,
  ) {}

  async reconcile(context: TenantContext, source: SourceDefinition, productId: string, invoiceId: string) {
    requirePermission(context, "billing:write");
    if (source.tenantId !== context.tenantId || source.productId !== productId ||
        source.sourceType !== IRON_COMMERCIAL_SOURCE_TYPE ||
        source.secretRef !== IRON_COMMERCIAL_SECRET_REF) {
      throw new Error("billing.iron_source_scope_denied");
    }

    const proof = await this.paidInvoices.findVerifiedProductionPayment(context.tenantId, productId, invoiceId);
    if (!proof || proof.tenantId !== context.tenantId || proof.productId !== productId ||
        proof.invoiceId !== invoiceId || proof.productSlug !== FMCC_IRON_PRODUCT_SLUG ||
        proof.invoiceStatus !== "paid" || proof.paymentStatus !== "received" ||
        proof.gatewayEnvironment !== "production" || !Number.isSafeInteger(proof.amountMinor) ||
        proof.amountMinor <= 0 || !proof.paymentId) {
      throw new Error("billing.iron_payment_unverified");
    }

    // The mapping was registered by FM billing authority and is immutable for
    // this commercial plan code. An invoice predating the binding cannot inherit it.
    const mapping = resolveIronPlanMapping(source.config, proof.planCode);
    const issuedAt = new Date(proof.invoiceCreatedAt);
    const mappedAt = new Date(mapping.effectiveFrom);
    if (Number.isNaN(issuedAt.getTime()) || issuedAt.getTime() < mappedAt.getTime()) {
      throw new Error("billing.iron_mapping_not_effective_for_invoice");
    }

    // IRON uses UUID gym identifiers, not a free-form customer name.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proof.externalTenantId)) {
      throw new Error("billing.iron_tenant_binding_invalid");
    }

    const connection = {
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      timeoutMs: 8000,
    };
    const snapshot = await this.connector.snapshot(connection, source);
    if (snapshot.product_code !== "IRON_FIT_CORE" ||
        snapshot.coverage.subscription_projection !== "IRON_CANONICAL") {
      throw new Error("billing.iron_snapshot_not_authoritative");
    }

    const matching = snapshot.subscriptions
      .map(ironSubscription)
      .filter((row): row is IronSubscriptionRow =>
        row !== null && row.tenant_id === proof.externalTenantId &&
        row.status !== "CANCELED");
    if (matching.length !== 1) {
      throw new Error("billing.iron_subscription_binding_ambiguous");
    }
    const current = matching[0];
    // A purchased Command plan cannot silently unlock a different IRON plan.
    // Future commercial-to-IRON plan mappings must be explicit and versioned.
    if (current.plan_code !== mapping.ironPlanCode ||
        current.plan_version !== mapping.ironPlanVersion) {
      throw new Error("billing.iron_plan_mapping_unavailable");
    }
    if (current.status !== "ACTIVE" && current.status !== "SUSPENDED") {
      throw new Error("billing.iron_subscription_status_invalid");
    }
    if (current.effective_until) {
      const end = new Date(current.effective_until);
      if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
        throw new Error("billing.iron_subscription_expired");
      }
    }

    const response = await this.connector.subscriptionCommand(connection, source, {
      action: "subscription.status.sync",
      gymId: proof.externalTenantId,
      expectedSubscriptionId: current.external_id,
      commercialStatus: "active",
      entitlementStatus: "ACTIVE",
      reason: "FM Command payment reconciled; invoice " + proof.invoiceId,
    }, "fmcc:verified-paid:v1:" + proof.invoiceId);

    return {
      productId, invoiceId: proof.invoiceId,
      gymId: proof.externalTenantId,
      ironSubscriptionId: current.external_id,
      mappingRevision: mapping.revision,
      ironPlanCode: mapping.ironPlanCode,
      ironPlanVersion: mapping.ironPlanVersion,
      result: response,
    };
  }
}
