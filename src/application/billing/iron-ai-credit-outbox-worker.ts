import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Job = { id: string; order_id: string; event_type: "GRANT" | "REVOKE"; attempts: number; claim_token: string };
type Scope = { gym_id: string; package_code: string; order_status: string; subscription_status: string; paid_through: Date | null };
export type CreditDeliveryResult = "idle" | "delivered" | "retry" | "blocked";

export class IronAiCreditOutboxWorker {
  constructor(
    private readonly pool: Pick<Pool, "query">,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly request: typeof fetch = fetch,
  ) {}

  private config() {
    const base = this.env.FMCC_IRON_CONTROL_PLANE_URL;
    const token = this.env.FMCC_IRON_CONTROL_PLANE_TOKEN;
    if (!base || !token || token.length < 32) throw new Error("iron.credits_delivery_config_missing");
    const url = new URL(base);
    if (url.protocol !== "https:" || url.hostname !== "api.ironfitcore.com.br" ||
      url.pathname !== "/api/v1/control-plane/fmcc" || url.search || url.hash || url.username || url.password)
      throw new Error("iron.credits_delivery_host_invalid");
    return { base: url.toString().replace(/\/$/, ""), token };
  }

  private async claim(): Promise<Job | null> {
    const result = await this.pool.query(`
      UPDATE fmcc_iron_ai_credit_outbox SET
        status='processing', claim_token=$1, lease_until=now()+interval '90 seconds',
        attempts=attempts+1, updated_at=now()
      WHERE id=(
        SELECT id FROM fmcc_iron_ai_credit_outbox
        WHERE (status IN ('pending','retry') AND available_at<=now())
          OR (status='processing' AND lease_until<now())
        ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id,order_id,event_type,attempts,claim_token
    `, [randomUUID()]);
    return (result.rows[0] ?? null) as Job | null;
  }

  private async resolve(job: Job): Promise<Scope> {
    const result = await this.pool.query(`
      SELECT o.gym_id,o.package_code,o.status AS order_status,
             s.status AS subscription_status,s.paid_through
      FROM fmcc_iron_ai_credit_outbox q
      JOIN fmcc_iron_ai_credit_order o ON o.id=q.order_id
      JOIN fmcc_billing_subscription s
        ON s.tenant_id=o.tenant_id AND s.id=o.subscription_id
           AND s.product_id=o.product_id AND s.customer_id=o.customer_id
      JOIN fmcc_billing_customer_binding b
        ON b.tenant_id=o.tenant_id AND b.product_id=o.product_id
           AND b.customer_id=o.customer_id AND b.external_tenant_id=o.gym_id::text
      WHERE q.id=$1 AND q.order_id=$2 AND q.claim_token=$3 AND q.status='processing'
      LIMIT 2
    `, [job.id,job.order_id,job.claim_token]);
    if (result.rows.length !== 1) throw new Error("iron.credits_delivery_binding_missing");
    return result.rows[0] as Scope;
  }

  private async deliver(job: Job): Promise<void> {
    const cfg = this.config();
    const binding = await this.resolve(job);
    if (!UUID.test(binding.gym_id) || !UUID.test(job.order_id))
      throw new Error("iron.credits_delivery_scope_invalid");
    // A refund can arrive before the original GRANT is delivered: do not grant a refunded order.
    if (job.event_type === "GRANT" && binding.order_status === "refunded") return;
    if (job.event_type === "GRANT" &&
      (binding.order_status !== "paid" || binding.subscription_status !== "active" ||
      !binding.paid_through || binding.paid_through.getTime() <= Date.now()))
      throw new Error("iron.credits_delivery_not_paid_or_active");
    if (job.event_type === "REVOKE" && binding.order_status !== "refunded")
      throw new Error("iron.credits_delivery_not_refunded");

    const path = job.event_type === "GRANT" ? "grant" : "revoke";
    const body = job.event_type === "GRANT" ? {
      tenantId: binding.gym_id,
      sourceInvoiceId: job.order_id,
      packageCode: binding.package_code,
      paymentStatus: "PAID",
    } : { tenantId: binding.gym_id, sourceInvoiceId: job.order_id };
    const cancellation = new AbortController();
    const timer = setTimeout(() => cancellation.abort(), 12000);
    try {
      const response = await this.request(cfg.base + "/ai/credits/" + path, {
        method: "POST", redirect: "error", cache: "no-store", signal: cancellation.signal,
        headers: {
          authorization: "Bearer " + cfg.token,
          "x-correlation-id": randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("iron.credits_delivery_http_" + response.status);
    } finally { clearTimeout(timer); }
  }

  async processOne(): Promise<CreditDeliveryResult> {
    const job = await this.claim();
    if (!job) return "idle";
    try {
      await this.deliver(job);
      const done = await this.pool.query(`
        UPDATE fmcc_iron_ai_credit_outbox SET status='delivered',
          lease_until=NULL,claim_token=NULL,last_error_code=NULL,
          delivered_at=now(),updated_at=now()
        WHERE id=$1 AND claim_token=$2 AND status='processing'
      `, [job.id,job.claim_token]);
      return done.rowCount === 1 ? "delivered" : "retry";
    } catch (error) {
      const code = error instanceof Error ? error.message : "iron.credits_delivery_unknown";
      const permanent = /iron\.credits_delivery_(host_invalid|config_missing|binding_missing|scope_invalid)/.test(code)
        || /iron\.credits_delivery_http_40[0134]/.test(code);
      const blocked = permanent || job.attempts >= 12;
      const seconds = Math.min(1800, 10 * 2 ** Math.min(job.attempts, 8));
      await this.pool.query(`
        UPDATE fmcc_iron_ai_credit_outbox SET status=$3,
          available_at=now()+make_interval(secs => $4),lease_until=NULL,
          claim_token=NULL,last_error_code=$5,updated_at=now()
        WHERE id=$1 AND claim_token=$2 AND status='processing'
      `, [job.id,job.claim_token,blocked ? "blocked" : "retry",seconds,code.slice(0,120)]);
      return blocked ? "blocked" : "retry";
    }
  }
}
