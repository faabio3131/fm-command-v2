import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import { resolveIronPlanMapping } from "@/domain/billing/iron-versioned-plan-mapping";
import type { SourceDefinition } from "@/domain/integration/contracts";
import {
  IRON_COMMERCIAL_SECRET_REF,
  IRON_COMMERCIAL_SOURCE_TYPE,
  type IronCommercialConnector,
  type IronCommercialSnapshot,
} from "@/infrastructure/integration/iron-commercial-connector";
import type {
  PostgresIronEntitlementOutbox,
  IronLicenseEvent,
} from "@/infrastructure/billing/postgres-iron-entitlement-outbox";

type OutboxRepository = Pick<PostgresIronEntitlementOutbox, "claim" | "authority" | "acknowledge" | "fail">;
type CommandConnector = Pick<IronCommercialConnector, "snapshot" | "subscriptionCommand">;

class PermanentDeliveryError extends Error {
  constructor(readonly code: string) { super(code); }
}

const GYM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function targetState(type: IronLicenseEvent) {
  switch (type) {
    case "LICENSE_ACTIVATE": return { commercialStatus: "active", entitlementStatus: "ACTIVE" } as const;
    case "LICENSE_SUSPEND": return { commercialStatus: "delinquent", entitlementStatus: "SUSPENDED" } as const;
    case "LICENSE_CANCEL": return { commercialStatus: "cancelled", entitlementStatus: "CANCELED" } as const;
  }
}

function singleIronSubscription(
  snapshot: IronCommercialSnapshot, gymId: string, code: string, version: number,
) {
  if (snapshot.product_code !== "IRON_FIT_CORE" ||
      snapshot.coverage.subscription_projection !== "IRON_CANONICAL") {
    throw new PermanentDeliveryError("IRON_SNAPSHOT_NOT_CANONICAL");
  }
  const asOf = new Date(snapshot.as_of).getTime();
  if (Number.isNaN(asOf) || Date.now() - asOf > 300_000 || asOf - Date.now() > 30_000) {
    throw new PermanentDeliveryError("IRON_SNAPSHOT_STALE");
  }
  const matches = snapshot.subscriptions.filter(row =>
    row.tenant_id === gymId && row.plan_code === code &&
    row.plan_version === version && typeof row.external_id === "string" &&
    typeof row.status === "string",
  );
  if (matches.length !== 1 || !GYM_UUID.test(String(matches[0].external_id))) {
    throw new PermanentDeliveryError("IRON_SUBSCRIPTION_AMBIGUOUS");
  }
  return matches[0] as { external_id: string; status: string; effective_until?: string | null };
}

/**
 * Explicitly operator-gated dispatcher; no automatic gateway-to-license path.
 * Only existing authoritative Command billing state and existing IRON control
 * plane can determine a final entitlement status.
 */
export class GovernedIronOutboxDispatcher {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly connector: CommandConnector,
  ) {}

  async processOne(context: TenantContext, source: SourceDefinition, productId: string) {
    requirePermission(context, "billing:write");
    if (context.role !== "owner" && context.role !== "admin") {
      throw new PermanentDeliveryError("IRON_DISPATCH_ROLE_DENIED");
    }
    if (source.tenantId !== context.tenantId || source.productId !== productId ||
        source.sourceType !== IRON_COMMERCIAL_SOURCE_TYPE ||
        source.secretRef !== IRON_COMMERCIAL_SECRET_REF ||
        source.authoritativeDomain !== "commercial" ||
        source.name !== "IRON FIT CORE Commercial") {
      throw new PermanentDeliveryError("IRON_DISPATCH_SOURCE_DENIED");
    }

    const item = await this.repository.claim(context.tenantId, productId);
    if (!item) return { status: "empty" as const };
    try {
      const authority = await this.repository.authority(item);
      if (!authority || !GYM_UUID.test(authority.externalTenantId)) {
        throw new PermanentDeliveryError("IRON_OUTBOX_CANONICAL_STATE_CHANGED");
      }
      const plan = resolveIronPlanMapping(source.config, authority.planCode);
      const connection = {
        tenantId: context.tenantId,
        correlationId: context.correlationId,
        timeoutMs: 8_000,
      };
      const snapshot = await this.connector.snapshot(connection, source);
      const current = singleIronSubscription(
        snapshot, authority.externalTenantId, plan.ironPlanCode, plan.ironPlanVersion,
      );
      if (item.eventType !== "LICENSE_CANCEL" &&
          current.status === "CANCELED") {
        throw new PermanentDeliveryError("IRON_SUBSCRIPTION_ALREADY_CANCELED");
      }
      if (item.eventType === "LICENSE_ACTIVATE" && current.effective_until) {
        const expiry = new Date(current.effective_until).getTime();
        if (Number.isNaN(expiry) || expiry <= Date.now()) {
          throw new PermanentDeliveryError("IRON_SUBSCRIPTION_EXPIRED");
        }
      }
      const target = targetState(item.eventType);
      const response = await this.connector.subscriptionCommand(connection, source, {
        action: "subscription.status.sync",
        gymId: authority.externalTenantId,
        expectedSubscriptionId: current.external_id,
        ...target,
        reason: "FM Command verified canonical outbox event " + item.id,
      }, "fmcc:iron:outbox:v1:" + item.id);
      const result = response.result;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new PermanentDeliveryError("IRON_RESPONSE_CONTRACT_INVALID");
      }
      const completed = result as Record<string, unknown>;
      if (completed.tenantId !== authority.externalTenantId ||
          completed.subscriptionId !== current.external_id ||
          completed.entitlementStatus !== target.entitlementStatus ||
          completed.planCode !== plan.ironPlanCode ||
          completed.planVersion !== plan.ironPlanVersion) {
        throw new PermanentDeliveryError("IRON_RESPONSE_SCOPE_MISMATCH");
      }
      if (!await this.repository.acknowledge(item)) {
        throw new Error("IRON_OUTBOX_ACK_LEASE_LOST");
      }
      return {
        status: "delivered" as const,
        eventId: item.id,
        gymId: authority.externalTenantId,
        entitlementStatus: target.entitlementStatus,
        mappingRevision: plan.revision,
      };
    } catch (error) {
      const permanent = error instanceof PermanentDeliveryError;
      const code = permanent ? error.code : "IRON_OUTBOX_DELIVERY_RETRYABLE";
      const fenced = await this.repository.fail(item, code, permanent);
      return { status: fenced ? (permanent ? "blocked" as const : "retry" as const) : "lease_lost" as const,
        eventId: item.id, errorCode: code };
    }
  }
}
