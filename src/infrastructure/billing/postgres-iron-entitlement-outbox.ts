import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type IronLicenseEvent = "LICENSE_ACTIVATE" | "LICENSE_SUSPEND" | "LICENSE_CANCEL";
export type IronOutboxState = "pending" | "processing" | "retry" | "delivered" | "blocked";

export interface IronOutboxAuthority {
  readonly externalTenantId: string;
  readonly planCode: string;
  readonly subscriptionStatus: string;
  readonly invoiceStatus: string;
  readonly paymentStatus: string | null;
}

export interface IronOutboxItem {
  id: string;
  tenantId: string;
  productId: string;
  invoiceId: string;
  subscriptionId: string;
  eventType: IronLicenseEvent;
  idempotencyKey: string;
  attempts: number;
  claimToken: string;
}

export function canonicalStateForEvent(eventType: IronLicenseEvent) {
  switch (eventType) {
    case "LICENSE_ACTIVATE": return "active";
    case "LICENSE_SUSPEND": return "past_due";
    case "LICENSE_CANCEL": return "cancelled";
  }
}

export function outboxDedupeKey(invoiceId: string, subscriptionId: string, eventType: IronLicenseEvent) {
  return ["iron", "entitlement", "v1", invoiceId, subscriptionId, eventType].join(":");
}

const expectedTypes = new Set<IronLicenseEvent>(["LICENSE_ACTIVATE", "LICENSE_SUSPEND", "LICENSE_CANCEL"]);
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
function assertScope(input: { tenantId: string; productId: string; invoiceId?: string }) {
  if (!input.tenantId || input.tenantId.length > 128 || !validId(input.productId) ||
      (input.invoiceId !== undefined && !validId(input.invoiceId))) {
    throw new Error("billing.iron_outbox_scope_invalid");
  }
}

/**
 * FM-owned transactional outbox. Enqueue does not trust webhook/browser state.
 * It inspects and locks the canonical invoice and subscription in one DB tx.
 * The event remains inert unless a separately gated dispatcher is certified.
 */
export class PostgresIronEntitlementOutbox {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async enqueue(input: {
    tenantId: string; productId: string; invoiceId: string; eventType: IronLicenseEvent;
  }): Promise<{ id: string; inserted: boolean }> {
    assertScope(input);
    if (!expectedTypes.has(input.eventType)) throw new Error("billing.iron_outbox_event_invalid");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const state = await client.query<{
        invoice_id: string; subscription_id: string; subscription_status: string;
        invoice_status: string; payment_status: string | null; environment: string;
      }>(`
        SELECT i.id AS invoice_id, s.id AS subscription_id,
               s.status AS subscription_status, i.status AS invoice_status,
               p.status AS payment_status, g.environment
        FROM fmcc_billing_invoice i
        JOIN fmcc_billing_subscription s ON s.tenant_id=i.tenant_id
          AND s.id=i.subscription_id AND s.product_id=i.product_id AND s.customer_id=i.customer_id
        JOIN fmcc_billing_gateway_account g ON g.tenant_id=i.tenant_id AND g.id=i.gateway_account_id
        LEFT JOIN fmcc_billing_product_route r ON r.tenant_id=i.tenant_id AND r.product_id=i.product_id
          AND r.gateway_account_id=g.id
        JOIN fmcc_product_definition product ON product.tenant_id=i.tenant_id AND product.id=i.product_id
        LEFT JOIN fmcc_billing_provider_payment p ON p.tenant_id=i.tenant_id
          AND p.invoice_id=i.id AND p.gateway_account_id=g.id
        WHERE i.tenant_id=$1 AND i.product_id=$2 AND i.id=$3
          AND product.slug='iron' AND product.status='active'
          AND g.environment='production'
          AND ($4 <> 'LICENSE_ACTIVATE' OR (g.status='enabled' AND r.status='enabled'))
        FOR UPDATE OF i, s
      `, [input.tenantId, input.productId, input.invoiceId, input.eventType]);
      if (state.rowCount !== 1) throw new Error("billing.iron_outbox_authority_unverified");
      const row = state.rows[0];
      if (row.subscription_status !== canonicalStateForEvent(input.eventType)) {
        throw new Error("billing.iron_outbox_subscription_state_mismatch");
      }
      // No claim of provider confirmation for pending/sandbox/forged webhooks.
      if (input.eventType === "LICENSE_ACTIVATE" &&
          (row.invoice_status !== "paid" || row.payment_status !== "received")) {
        throw new Error("billing.iron_outbox_payment_unverified");
      }
      const key = outboxDedupeKey(row.invoice_id, row.subscription_id, input.eventType);
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO fmcc_billing_iron_entitlement_outbox
          (tenant_id, product_id, invoice_id, subscription_id, event_type, idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id,product_id,idempotency_key) DO NOTHING
        RETURNING id
      `, [input.tenantId, input.productId, row.invoice_id, row.subscription_id, input.eventType, key]);
      const wasInserted = inserted.rowCount === 1;
      const found = wasInserted ? inserted : await client.query<{ id: string }>(`
        SELECT id FROM fmcc_billing_iron_entitlement_outbox
        WHERE tenant_id=$1 AND product_id=$2 AND idempotency_key=$3
      `, [input.tenantId, input.productId, key]);
      if (found.rowCount !== 1) throw new Error("billing.iron_outbox_dedupe_invariant");
      await client.query("COMMIT");
      return { id: found.rows[0].id, inserted: wasInserted };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * SKIP LOCKED gives exclusive claims across concurrent workers.
   * A crashed worker's lease is reclaimed; maximum 12 total attempts.
   * This method only claims, never communicates with IRON by itself.
   */
  async claim(tenantId: string, productId: string): Promise<IronOutboxItem | null> {
    assertScope({ tenantId, productId });
    const token = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<{
        id: string; tenant_id: string; product_id: string; invoice_id: string;
        subscription_id: string; event_type: IronLicenseEvent; idempotency_key: string; attempts: number;
      }>(`
        WITH candidate AS (
          SELECT id FROM fmcc_billing_iron_entitlement_outbox
          WHERE tenant_id=$1 AND product_id=$2 AND attempts < 12
            AND ((status IN ('pending','retry') AND available_at <= now())
              OR (status='processing' AND lease_until < now()))
            AND NOT EXISTS (
              SELECT 1 FROM fmcc_billing_iron_entitlement_outbox older
              WHERE older.tenant_id=fmcc_billing_iron_entitlement_outbox.tenant_id
                AND older.product_id=fmcc_billing_iron_entitlement_outbox.product_id
                AND older.subscription_id=fmcc_billing_iron_entitlement_outbox.subscription_id
                AND (older.created_at,older.id) <
                    (fmcc_billing_iron_entitlement_outbox.created_at,fmcc_billing_iron_entitlement_outbox.id)
                AND older.status IN ('pending','retry','processing')
            )
          ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE fmcc_billing_iron_entitlement_outbox o SET
          status='processing', attempts=o.attempts+1, claim_token=$3,
          lease_until=now()+interval '90 seconds', updated_at=now()
        FROM candidate WHERE o.id=candidate.id
        RETURNING o.id,o.tenant_id,o.product_id,o.invoice_id,o.subscription_id,
                  o.event_type,o.idempotency_key,o.attempts
      `, [tenantId, productId, token]);
      await client.query("COMMIT");
      if (claimed.rowCount !== 1) return null;
      const c = claimed.rows[0];
      return {
        id: c.id, tenantId: c.tenant_id, productId: c.product_id,
        invoiceId: c.invoice_id, subscriptionId: c.subscription_id,
        eventType: c.event_type, idempotencyKey: c.idempotency_key,
        attempts: c.attempts, claimToken: token,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Revalidate the financial state *after* claiming and immediately before
   * delivery. A revoked gateway or rerouted account must not prevent license
   * revocation, but cannot be the basis for a new activation.
   */
  async authority(item: IronOutboxItem): Promise<IronOutboxAuthority | null> {
    assertScope({ tenantId: item.tenantId, productId: item.productId, invoiceId: item.invoiceId });
    const client = await this.pool.connect();
    try {
      const result = await client.query<{
        external_tenant_id: string; plan_code: string;
        subscription_status: string; invoice_status: string;
        payment_status: string | null; gateway_status: string;
        gateway_environment: string; route_status: string | null;
      }>(`
        SELECT b.external_tenant_id,s.plan_code,
          s.status AS subscription_status,i.status AS invoice_status,
          p.status AS payment_status,g.status AS gateway_status,
          g.environment AS gateway_environment,r.status AS route_status
        FROM fmcc_billing_iron_entitlement_outbox o
        JOIN fmcc_billing_invoice i ON i.tenant_id=o.tenant_id AND i.id=o.invoice_id
          AND i.product_id=o.product_id AND i.subscription_id=o.subscription_id
        JOIN fmcc_billing_subscription s ON s.tenant_id=i.tenant_id AND s.id=i.subscription_id
          AND s.product_id=i.product_id AND s.customer_id=i.customer_id
        JOIN fmcc_billing_customer_binding b ON b.tenant_id=i.tenant_id
          AND b.product_id=i.product_id AND b.customer_id=i.customer_id
        JOIN fmcc_billing_gateway_account g ON g.tenant_id=i.tenant_id AND g.id=i.gateway_account_id
        LEFT JOIN fmcc_billing_product_route r ON r.tenant_id=i.tenant_id
          AND r.product_id=i.product_id AND r.gateway_account_id=g.id
        LEFT JOIN fmcc_billing_provider_payment p ON p.tenant_id=i.tenant_id
          AND p.invoice_id=i.id AND p.gateway_account_id=i.gateway_account_id
        JOIN fmcc_product_definition product ON product.tenant_id=i.tenant_id
          AND product.id=i.product_id
        WHERE o.id=$1 AND o.tenant_id=$2 AND o.product_id=$3
          AND o.subscription_id=$4 AND o.claim_token=$5
          AND o.status='processing' AND o.lease_until>now()
          AND product.slug='iron' AND product.status='active'
          AND g.environment='production'
      `, [item.id, item.tenantId, item.productId, item.subscriptionId, item.claimToken]);
      if (result.rowCount !== 1) return null;
      const row = result.rows[0];
      if (row.subscription_status !== canonicalStateForEvent(item.eventType)) return null;
      if (item.eventType === "LICENSE_ACTIVATE" &&
          (row.invoice_status !== "paid" || row.payment_status !== "received" ||
           row.gateway_status !== "enabled" || row.route_status !== "enabled")) return null;
      return {
        externalTenantId: row.external_tenant_id, planCode: row.plan_code,
        subscriptionStatus: row.subscription_status,
        invoiceStatus: row.invoice_status, paymentStatus: row.payment_status,
      };
    } finally {
      client.release();
    }
  }

  async acknowledge(item: IronOutboxItem): Promise<boolean> {
    assertScope(item);
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        UPDATE fmcc_billing_iron_entitlement_outbox SET
          status='delivered', delivered_at=now(), lease_until=NULL,
          claim_token=NULL, last_error_code=NULL, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND product_id=$3
          AND claim_token=$4 AND status='processing' AND lease_until > now()
      `, [item.id, item.tenantId, item.productId, item.claimToken]);
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }

  async fail(item: IronOutboxItem, code: string, permanent = false): Promise<boolean> {
    assertScope(item);
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(code)) throw new Error("billing.iron_outbox_error_code_invalid");
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        UPDATE fmcc_billing_iron_entitlement_outbox SET
          status=CASE WHEN $5 OR attempts>=12 THEN 'blocked' ELSE 'retry' END,
          available_at=now()+make_interval(secs => LEAST(3600, (power(2,LEAST(attempts,10))::integer)*5)),
          lease_until=NULL, claim_token=NULL, last_error_code=$6, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND product_id=$3
          AND claim_token=$4 AND status='processing' AND lease_until > now()
      `, [item.id, item.tenantId, item.productId, item.claimToken, permanent, code]);
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }
}
