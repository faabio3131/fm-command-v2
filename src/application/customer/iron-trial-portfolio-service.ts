import type { TenantContext } from "@/domain/security/tenant-context";
import { requirePermission } from "@/domain/security/tenant-context";
import { IronControlPlaneClient } from "@/application/integration/iron-control-plane-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 10_000;
const VISIBLE_ROWS = 50;

export type IronTrialCustomer = {
  readonly gymId: string;
  readonly gymName: string;
  readonly gymCreatedAt: string;
  readonly trialStartedAt: string;
  readonly trialEndsAt: string;
  readonly trialStatus: "active" | "expired";
  readonly subscriptionStatus: "ACTIVE" | "SUSPENDED" | "CANCELED";
  readonly planCode: string;
};

export type IronTrialPortfolio =
  | { readonly status: "not_applicable" }
  | { readonly status: "unavailable" }
  | {
      readonly status: "ready";
      readonly sourceAuthority: "IRON_CANONICAL";
      readonly asOf: string;
      readonly total: number;
      readonly page: number;
      readonly pageCount: number;
      readonly customers: readonly IronTrialCustomer[];
    };

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("iron.trial_snapshot_invalid");
  }
  return value as RecordValue;
}

function nonEmpty(value: unknown, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error("iron.trial_snapshot_invalid");
  }
  return value;
}

function uuid(value: unknown): string {
  const text = nonEmpty(value, 36);
  if (!UUID.test(text)) throw new Error("iron.trial_snapshot_invalid");
  return text;
}

function isoDate(value: unknown): string {
  const text = nonEmpty(value, 40);
  if (!Number.isFinite(new Date(text).getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    throw new Error("iron.trial_snapshot_invalid");
  }
  return text;
}

function records(value: unknown): RecordValue[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) {
    throw new Error("iron.trial_snapshot_invalid");
  }
  return value.map(object);
}

/**
 * View model only. IRON owns Gym, CommercialTrialProvisioning and subscription.
 * FM Command does not persist a duplicate tenant or invent conversion facts.
 */
export function projectIronTrialSnapshot(snapshot: unknown, requestedPage = 1): Extract<IronTrialPortfolio, { status: "ready" }> {
  const source = object(snapshot);
  if (source.schema_version !== "iron.fmcc.commercial.v1" ||
      source.product_code !== "IRON_FIT_CORE") {
    throw new Error("iron.trial_snapshot_invalid");
  }
  const coverage = object(source.coverage);
  if (coverage.tenant !== "IRON_CANONICAL" || coverage.trial !== "IRON_CANONICAL") {
    throw new Error("iron.trial_snapshot_invalid");
  }

  const customers = new Map<string, { name: string; createdAt: string }>();
  for (const customer of records(source.customers)) {
    const gymId = uuid(customer.tenant_id);
    if (customers.has(gymId) || typeof customer.active !== "boolean") {
      throw new Error("iron.trial_snapshot_invalid");
    }
    customers.set(gymId, {
      name: nonEmpty(customer.name, 160),
      createdAt: isoDate(customer.created_at),
    });
  }

  const subscriptions = new Map<string, { gymId: string; status: IronTrialCustomer["subscriptionStatus"]; planCode: string }>();
  for (const subscription of records(source.subscriptions)) {
    const subscriptionId = uuid(subscription.external_id);
    const status = subscription.status;
    if (subscriptions.has(subscriptionId) || !["ACTIVE", "SUSPENDED", "CANCELED"].includes(String(status))) {
      throw new Error("iron.trial_snapshot_invalid");
    }
    subscriptions.set(subscriptionId, {
      gymId: uuid(subscription.tenant_id),
      status: status as IronTrialCustomer["subscriptionStatus"],
      planCode: nonEmpty(subscription.plan_code, 64),
    });
  }

  const seen = new Set<string>();
  const rows: IronTrialCustomer[] = records(source.trials).map((trial) => {
    const requestId = nonEmpty(trial.external_id, 160);
    const gymId = uuid(trial.tenant_id);
    const subscriptionId = uuid(trial.subscription_id);
    const gym = customers.get(gymId);
    const subscription = subscriptions.get(subscriptionId);
    const status = trial.status;
    if (seen.has(requestId) || !gym || !subscription || subscription.gymId !== gymId ||
        (status !== "active" && status !== "expired")) {
      throw new Error("iron.trial_snapshot_invalid");
    }
    seen.add(requestId);
    const startedAt = isoDate(trial.started_at);
    const endsAt = isoDate(trial.ends_at);
    if (new Date(endsAt) <= new Date(startedAt)) throw new Error("iron.trial_snapshot_invalid");
    return {
      gymId,
      gymName: gym.name,
      gymCreatedAt: gym.createdAt,
      trialStartedAt: startedAt,
      trialEndsAt: endsAt,
      trialStatus: status,
      subscriptionStatus: subscription.status,
      planCode: subscription.planCode,
    };
  });

  rows.sort((a, b) => b.trialStartedAt.localeCompare(a.trialStartedAt) || a.gymId.localeCompare(b.gymId));
  const pageCount = Math.max(1, Math.ceil(rows.length / VISIBLE_ROWS));
  const page = Math.min(
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageCount,
  );
  return {
    status: "ready",
    sourceAuthority: "IRON_CANONICAL",
    asOf: isoDate(source.as_of),
    total: rows.length,
    page,
    pageCount,
    customers: rows.slice((page - 1) * VISIBLE_ROWS, page * VISIBLE_ROWS),
  };
}

/**
 * Reads only when the caller's FM company and selected product match the
 * preconfigured IRON boundary. Paid offers and the Cakto state are irrelevant.
 * The guarded S2S client enforces the official HTTPS endpoint, bearer,
 * correlation id, no redirects and a request deadline.
 */
export class IronTrialPortfolioService {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async read(context: TenantContext, selectedProductId?: string, page = 1): Promise<IronTrialPortfolio> {
    requirePermission(context, "commercial:read");
    const tenantId = this.env.FMCC_IRON_BILLING_TENANT_ID;
    if (tenantId && tenantId !== context.tenantId) return { status: "not_applicable" };
    const productId = this.env.FMCC_IRON_PRODUCT_ID;
    if (productId && selectedProductId && selectedProductId !== productId) {
      return { status: "not_applicable" };
    }
    if (!tenantId || !productId) return { status: "unavailable" };
    try {
      const snapshot = await new IronControlPlaneClient(this.env, this.transport)
        .readTrialSnapshot(context.tenantId, selectedProductId);
      if (snapshot === null) return { status: "not_applicable" };
      return projectIronTrialSnapshot(snapshot, page);
    } catch {
      // Missing, stale, rejected and inconsistent upstream data is never zero.
      // Do not expose errors with environment details, Bearer or URL to users.
      return { status: "unavailable" };
    }
  }
}
