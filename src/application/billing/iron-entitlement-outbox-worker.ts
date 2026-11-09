import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type IronLicenseEvent = "LICENSE_ACTIVATE" | "LICENSE_SUSPEND" | "LICENSE_CANCEL";
export type IronLicenseSyncCommand = {
  action: "subscription.status.sync";
  gymId: string;
  expectedSubscriptionId: string;
  commercialStatus: "active" | "suspended" | "cancelled";
  entitlementStatus: "ACTIVE" | "SUSPENDED" | "CANCELED";
  reason: string;
  paidThrough?: string;
};

type SnapshotSubscription = {
  tenant_id?: unknown; external_id?: unknown; plan_code?: unknown; status?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The IRON domain remains the authority for its subscription identifier.
 * Neither webhook data nor a Cakto customer email can invent a gym or IRON subscription.
 */
export function selectIronSubscription(snapshot: unknown, gymId: string, planCode: string) {
  if (!UUID.test(gymId) || typeof planCode !== "string" || !planCode) throw new Error("iron.entitlement_binding_invalid");
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("iron.snapshot_invalid");
  const rows = (snapshot as { subscriptions?: unknown }).subscriptions;
  if (!Array.isArray(rows)) throw new Error("iron.snapshot_invalid");
  const matching = (rows as SnapshotSubscription[]).filter(s =>
    s && s.tenant_id === gymId && s.plan_code === planCode && s.status !== "CANCELED" && UUID.test(String(s.external_id ?? "")));
  if (matching.length !== 1) throw new Error("iron.subscription_not_unique_or_missing");
  return matching[0].external_id as string;
}

export function ironLicenseCommand(eventType: IronLicenseEvent, gymId: string, subscriptionId: string, invoiceId: string): IronLicenseSyncCommand {
  if (!UUID.test(gymId) || !UUID.test(subscriptionId) || !UUID.test(invoiceId)) throw new Error("iron.command_scope_invalid");
  const byEvent = {
    LICENSE_ACTIVATE: ["active", "ACTIVE"],
    LICENSE_SUSPEND: ["suspended", "SUSPENDED"],
    LICENSE_CANCEL: ["cancelled", "CANCELED"],
  } as const;
  const values = byEvent[eventType];
  if (!values) throw new Error("iron.command_event_invalid");
  return {
    action: "subscription.status.sync", gymId, expectedSubscriptionId: subscriptionId,
    commercialStatus: values[0], entitlementStatus: values[1],
    reason: "FM Command canonical billing invoice " + invoiceId,
  };
}

type Pending = {
  id: string; tenant_id: string; product_id: string; invoice_id: string;
  subscription_id: string; event_type: IronLicenseEvent; attempts: number; claim_token: string;
};
type Binding = { gym_id: string; plan_code: string; invoice_status: string; subscription_status: string; paid_through: Date | null; invoice_period_end: Date | null };
export type WorkerResult = "idle" | "delivered" | "retry" | "blocked";

export class IronEntitlementOutboxWorker {
  constructor(
    private readonly pool: Pick<Pool, "query">,
    private readonly env: Record<string, string | undefined>,
    private readonly request: typeof fetch = fetch,
  ) {}

  private config() {
    const base = this.env.FMCC_IRON_CONTROL_PLANE_URL;
    const token = this.env.FMCC_IRON_CONTROL_PLANE_TOKEN;
    if (!base || !token || token.length < 32) throw new Error("iron.delivery_config_missing");
    const url = new URL(base);
    if (url.protocol !== "https:" || url.hostname !== "api.ironfitcore.com.br" ||
      url.pathname !== "/api/v1/control-plane/fmcc" || url.search || url.hash || url.username || url.password)
      throw new Error("iron.delivery_host_invalid");
    return { base: url.toString().replace(/\/$/, ""), token };
  }

  private async claim(): Promise<Pending | null> {
    const result = await this.pool.query(`
      UPDATE fmcc_billing_iron_entitlement_outbox SET
        status='processing', claim_token=$1, lease_until=now()+interval '90 seconds',
        attempts=attempts+1, updated_at=now()
      WHERE id=(
        SELECT id FROM fmcc_billing_iron_entitlement_outbox
        WHERE (status IN ('pending','retry') AND available_at<=now())
          OR (status='processing' AND lease_until<now())
        ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, tenant_id, product_id, invoice_id, subscription_id, event_type, attempts, claim_token
    `, [randomUUID()]);
    return (result.rows[0] ?? null) as Pending | null;
  }

  private async binding(job: Pending): Promise<Binding> {
    const result = await this.pool.query(`
      SELECT b.external_tenant_id AS gym_id, s.plan_code,
             i.status AS invoice_status, s.status AS subscription_status,
             s.paid_through, i.period_end AS invoice_period_end
      FROM fmcc_billing_iron_entitlement_outbox o
      JOIN fmcc_billing_invoice i ON i.id=o.invoice_id AND i.tenant_id=o.tenant_id
                                  AND i.product_id=o.product_id AND i.subscription_id=o.subscription_id
      JOIN fmcc_billing_subscription s ON s.id=i.subscription_id AND s.tenant_id=i.tenant_id
                                        AND s.product_id=i.product_id AND s.customer_id=i.customer_id
      JOIN fmcc_billing_customer_binding b ON b.tenant_id=i.tenant_id AND b.product_id=i.product_id
                                             AND b.customer_id=i.customer_id
      WHERE o.id=$1 AND o.tenant_id=$2 AND o.product_id=$3
        AND o.subscription_id=$4 AND o.claim_token=$5 AND o.status='processing'
      LIMIT 2
    `, [job.id, job.tenant_id, job.product_id, job.subscription_id, job.claim_token]);
    if (result.rows.length !== 1) throw new Error("iron.delivery_binding_missing");
    const b = result.rows[0] as Binding;
    const paid = job.event_type === "LICENSE_ACTIVATE";
    if (paid && (b.invoice_status !== "paid" || !["active", "cancelled"].includes(b.subscription_status) ||
        !b.paid_through || !b.invoice_period_end ||
        b.paid_through < b.invoice_period_end || b.paid_through.getTime() <= Date.now()))
      throw new Error("iron.delivery_invoice_not_paid");
    if (!paid && !["refunded", "paid"].includes(b.invoice_status))
      throw new Error("iron.delivery_invoice_state_invalid");
    return b;
  }

  private async remote(url: string, token: string, init?: RequestInit) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    try {
      const response = await this.request(url, {
        ...init, signal: ctl.signal, redirect: "error", cache: "no-store",
        headers: { authorization: "Bearer " + token, "x-correlation-id": randomUUID(), ...(init?.headers ?? {}) },
      });
      if (!response.ok) throw new Error("iron.s2s_http_" + response.status);
      return response;
    } finally { clearTimeout(timer); }
  }

  private async deliver(job: Pending) {
    const cfg = this.config();
    const b = await this.binding(job);
    if (!UUID.test(b.gym_id)) throw new Error("iron.delivery_invalid_gym");
    const snap = await (await this.remote(cfg.base + "/snapshot", cfg.token)).json() as unknown;
    let ironSubId: string;
    try {
      ironSubId = selectIronSubscription(snap, b.gym_id, b.plan_code);
    } catch {
      if (job.event_type !== "LICENSE_ACTIVATE") throw new Error("iron.subscription_not_unique_or_missing");
      const records = (snap as { subscriptions?: unknown })?.subscriptions;
      if (!Array.isArray(records)) throw new Error("iron.snapshot_invalid");
      const active = records.filter((v: unknown) => {
        if (!v || typeof v !== "object" || Array.isArray(v)) return false;
        const item = v as Record<string, unknown>;
        return item.tenant_id === b.gym_id && item.status === "ACTIVE" && UUID.test(String(item.external_id ?? ""));
      }) as Array<{external_id: string; plan_code: string}>;
      if (active.length !== 1 || active[0].plan_code === b.plan_code)
        throw new Error("iron.subscription_not_unique_or_missing");
      const catalog = await (await this.remote(cfg.base + "/plan-versions", cfg.token)).json() as {
        plans?: Array<{ plan_code: string; version: number }>;
      };
      const targets = Array.isArray(catalog?.plans) ? catalog.plans.filter((p) =>
        p.plan_code === b.plan_code && Number.isSafeInteger(p.version) && p.version > 0) : [];
      if (targets.length !== 1) throw new Error("iron.plan_version_not_unique");
      const transition = {
        action: "subscription.plan.transition", gymId: b.gym_id,
        expectedSubscriptionId: active[0].external_id,
        planCode: b.plan_code, planVersion: targets[0].version, transitionKind: "PLAN_CHANGE",
        commercialStatus: "active",
        reason: "FM Command verified paid plan invoice " + job.invoice_id,
      };
      const change = await (await this.remote(cfg.base + "/subscription/commands", cfg.token, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": "fmcc-cakto-plan-" + job.id },
        body: JSON.stringify(transition),
      })).json() as { result?: { subscription?: { id?: unknown } } };
      const created = change?.result?.subscription?.id;
      if (!UUID.test(String(created ?? ""))) throw new Error("iron.plan_transition_unconfirmed");
      ironSubId = created as string;
    }
    const command = ironLicenseCommand(job.event_type, b.gym_id, ironSubId, job.invoice_id);
    if (job.event_type === "LICENSE_ACTIVATE") command.paidThrough = b.paid_through!.toISOString();
    // Outbox ID is a persistent delivery idempotency key: never issue a new command for retries.
    await this.remote(cfg.base + "/subscription/commands", cfg.token, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "fmcc-cakto-license-" + job.id },
      body: JSON.stringify(command),
    });
  }

  async processOne(): Promise<WorkerResult> {
    const job = await this.claim();
    if (!job) return "idle";
    try {
      await this.deliver(job);
      const res = await this.pool.query(`
        UPDATE fmcc_billing_iron_entitlement_outbox SET status='delivered',
            lease_until=NULL, claim_token=NULL, delivered_at=now(), updated_at=now(),
            last_error_code=NULL
        WHERE id=$1 AND claim_token=$2 AND status='processing'
      `, [job.id, job.claim_token]);
      return (res.rowCount ?? 0) === 1 ? "delivered" : "retry";
    } catch (e) {
      const code = e instanceof Error ? e.message : "iron.delivery_unknown_error";
      const permanent = /^iron\.(delivery_(host_invalid|config_missing|binding_missing|invoice_not_paid|invoice_state_invalid|invalid_gym)|subscription_not_unique_or_missing|plan_version_not_unique|plan_transition_unconfirmed|snapshot_invalid|command_.*)/.test(code)
        || /^iron\.s2s_http_40[0134]$/.test(code);
      const blocked = permanent || job.attempts >= 12;
      const backoffSeconds = Math.min(1800, 10 * 2 ** Math.min(job.attempts, 8));
      await this.pool.query(`
        UPDATE fmcc_billing_iron_entitlement_outbox SET status=$3,
           available_at=now()+make_interval(secs => $4), lease_until=NULL,
           claim_token=NULL, last_error_code=$5, updated_at=now()
        WHERE id=$1 AND claim_token=$2 AND status='processing'
      `, [job.id, job.claim_token, blocked ? "blocked" : "retry", backoffSeconds, code.slice(0, 120)]);
      return blocked ? "blocked" : "retry";
    }
  }
}
