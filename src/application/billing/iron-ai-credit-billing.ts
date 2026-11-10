import { createHash, randomUUID } from "node:crypto";
import { pool } from "@/infrastructure/db/client";
import { CaktoPaymentProvider } from "@/infrastructure/subscription/cakto-payment-provider";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-zA-Z0-9_.:-]{8,128}$/;

export const IRON_AI_WORKOUT_PACKS = Object.freeze({
  IRON_AI_WORKOUT_100: { units: 100, amountMinor: 1990 },
  IRON_AI_WORKOUT_300: { units: 300, amountMinor: 4990 },
  IRON_AI_WORKOUT_1000: { units: 1000, amountMinor: 12990 },
});
export type AiPackCode = keyof typeof IRON_AI_WORKOUT_PACKS;

export function ironAiPack(code: string): { units: number; amountMinor: number } {
  if (!Object.prototype.hasOwnProperty.call(IRON_AI_WORKOUT_PACKS, code))
    throw new Error("iron.credits_package_invalid");
  return IRON_AI_WORKOUT_PACKS[code as AiPackCode];
}

type Order = {
  id: string; tenant_id: string; product_id: string; gym_id: string;
  package_code: string; units: number; amount_minor: number;
  status: "pending" | "paid" | "refunded"; idempotency_key: string; payment_ref: string | null;
};
type Bound = {
  customer_id: string; subscription_id: string; gateway_account_id: string;
};

export class IronAiCreditBilling {
  private readonly provider: CaktoPaymentProvider;
  private readonly tenantId: string;
  private readonly productId: string;

  constructor(private readonly env: Record<string, string | undefined> = process.env) {
    this.tenantId = env.FMCC_IRON_BILLING_TENANT_ID ?? "";
    this.productId = env.FMCC_IRON_PRODUCT_ID ?? "";
    if (!/^[A-Za-z0-9._:-]{3,128}$/.test(this.tenantId) || !UUID.test(this.productId))
      throw new Error("iron.credits_authority_not_configured");
    this.provider = new CaktoPaymentProvider(env);
  }

  /** Read-only at the provider; canonical one-time invoice is issued in FM Command's own ledger. */
  async prepareCheckout(gymId: string, packageCode: string, idempotencyKey: string) {
    if (this.env.FMCC_IRON_COMMERCIAL_SALES_ENABLED !== "true")
      throw new Error("iron.credits_sales_not_authorized");
    if (!UUID.test(gymId) || !KEY.test(idempotencyKey))
      throw new Error("iron.credits_request_invalid");
    const pack = ironAiPack(packageCode);
    // Validate a configured EXACT one-time offer BEFORE issuing the invoice.
    const invoiceId = randomUUID();
    this.provider.oneTimeCheckout(invoiceId, pack.amountMinor);
    const client = await pool.connect();
    let result: Order;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        ["fmcc.iron.ai.credits:" + this.tenantId + ":" + this.productId + ":" + gymId + ":" + idempotencyKey],
      );
      const prior = await client.query<Order>(`
        SELECT * FROM fmcc_iron_ai_credit_order
        WHERE tenant_id=$1 AND product_id=$2 AND gym_id=$3 AND idempotency_key=$4
        LIMIT 1
      `, [this.tenantId, this.productId, gymId, idempotencyKey]);
      if (prior.rows.length) {
        result = prior.rows[0];
        if (result.package_code !== packageCode || result.status === "refunded")
          throw new Error("iron.credits_idempotency_conflict");
      } else {
        const bound = await client.query<Bound>(`
          SELECT b.customer_id, s.id AS subscription_id, r.gateway_account_id
          FROM fmcc_billing_customer_binding b
          JOIN fmcc_billing_subscription s
            ON s.tenant_id=b.tenant_id AND s.product_id=b.product_id
             AND s.customer_id=b.customer_id AND s.status='active' AND s.paid_through>now()
          JOIN fmcc_billing_product_route r
            ON r.tenant_id=b.tenant_id AND r.product_id=b.product_id AND r.status='enabled'
          JOIN fmcc_billing_gateway_account g
            ON g.tenant_id=r.tenant_id AND g.id=r.gateway_account_id
             AND g.provider='cakto' AND g.environment='production' AND g.status='enabled'
          WHERE b.tenant_id=$1 AND b.product_id=$2 AND b.external_tenant_id=$3
          LIMIT 2
        `, [this.tenantId, this.productId, gymId]);
        if (bound.rows.length !== 1) throw new Error("iron.credits_subscription_not_active_or_ambiguous");
        const b = bound.rows[0];
        const inserted = await client.query<Order>(`
          INSERT INTO fmcc_iron_ai_credit_order(
            id,tenant_id,product_id,gym_id,customer_id,subscription_id,gateway_account_id,
            package_code,units,amount_minor,idempotency_key)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING *
        `, [invoiceId,this.tenantId,this.productId,gymId,b.customer_id,b.subscription_id,
          b.gateway_account_id,packageCode,pack.units,pack.amountMinor,idempotencyKey]);
        result = inserted.rows[0];
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    return {
      invoiceId: result.id, packageCode: result.package_code,
      units: result.units, amountMinor: result.amount_minor,
      currency: "BRL" as const, status: result.status,
      checkoutUrl: result.status === "pending" ? this.provider.oneTimeCheckout(result.id, result.amount_minor) : null,
      idempotent: result.id !== invoiceId,
    };
  }

  /** Only a provider-signed event for the exact pre-authorized offer/price can change the ledger. */
  async handleWebhook(headers: Headers, raw: string): Promise<"applied" | "duplicate" | "ignored" | "unmatched"> {
    const event = this.provider.verifyOneTimeWebhook(headers, raw);
    if (!event || !event.paymentRef || !UUID.test(event.subscriptionRef)
      || !/^[A-Za-z0-9_-]{6,128}$/.test(event.paymentRef)) return "ignored";
    let source: string;
    try { source = String((JSON.parse(raw) as { event?: unknown }).event ?? ""); }
    catch { return "ignored"; }
    if (!["purchase_approved", "refund", "chargeback"].includes(source)) return "ignored";
    const isPaid = source === "purchase_approved";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const matched = await client.query<Order>(`
        SELECT * FROM fmcc_iron_ai_credit_order
        WHERE id=$1 AND tenant_id=$2 AND product_id=$3 FOR UPDATE
      `, [event.subscriptionRef,this.tenantId,this.productId]);
      if (!matched.rows.length) {
        await client.query("COMMIT");
        return "unmatched";
      }
      const order = matched.rows[0];
      if (isPaid && (event.type !== "payment_confirmed" || !event.amount ||
        event.amount.currency !== "BRL" || event.amount.amountMinor !== order.amount_minor)) {
        await client.query("COMMIT");
        return "ignored";
      }
      if (!isPaid && event.type !== "payment_refunded") {
        await client.query("COMMIT");
        return "ignored";
      }
      const next = isPaid ? "paid" : "refunded";
      if (order.status === next) {
        await client.query("COMMIT");
        return "duplicate";
      }
      if ((isPaid && order.status !== "pending") ||
        (!isPaid && (order.status !== "paid" || order.payment_ref !== event.paymentRef))) {
        await client.query("COMMIT");
        return "ignored";
      }
      const fingerprint = createHash("sha256").update(raw).digest("hex");
      await client.query(`
        INSERT INTO fmcc_iron_ai_credit_provider_event(order_id,payment_ref,event_type,fingerprint)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING
      `, [order.id,event.paymentRef,isPaid ? "GRANT" : "REVOKE",fingerprint]);
      const update = await client.query(`
        UPDATE fmcc_iron_ai_credit_order SET status=$2,payment_ref=$3,updated_at=now()
        WHERE id=$1
      `, [order.id,next, event.paymentRef]);
      if (update.rowCount !== 1) throw new Error("iron.credits_order_update_failed");
      await client.query(`
        INSERT INTO fmcc_iron_ai_credit_outbox(order_id,event_type,status)
        VALUES($1,$2,'pending') ON CONFLICT (order_id,event_type) DO NOTHING
      `, [order.id,isPaid ? "GRANT" : "REVOKE"]);
      await client.query("COMMIT");
      return "applied";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
