import type { Pool } from "pg";
import type { TenantContext } from "@/domain/security/tenant-context";
import { resolveIronPlanMapping } from "@/domain/billing/iron-versioned-plan-mapping";
import { ASAAS_PRODUCTION_SECRET_REF } from "./secret-resolver";
import { ironAsaasInvoiceReference, type VerifiedAsaasPayment } from "./asaas-iron-payment-readonly-client";
import { outboxDedupeKey, type IronLicenseEvent } from "./postgres-iron-entitlement-outbox";

export interface CanonicalAsaasIronPaymentBinding {
  readonly tenantId: string;
  readonly productId: string;
  readonly invoiceId: string;
  readonly subscriptionId: string;
  readonly gatewayAccountId: string;
  readonly paymentId: string;
  readonly customerId: string;
  readonly amountMinor: number;
}

/**
 * A provider GET alone is never authoritative for choosing a gym or a plan.
 * FM Command database supplies the binding; all external fields are compared.
 */
export class PostgresIronAsaasAtomicReconciliation {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async binding(tenantId: string, productId: string, invoiceId: string):
    Promise<CanonicalAsaasIronPaymentBinding | null> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{
        tenant_id: string; product_id: string; invoice_id: string;
        subscription_id: string; gateway_account_id: string;
        external_payment_id: string; external_customer_id: string; amount_minor: string;
      }>(`
        SELECT i.tenant_id,i.product_id,i.id AS invoice_id,i.subscription_id,
          i.gateway_account_id,p.external_payment_id,
          c.external_customer_id,i.amount_minor::text
        FROM fmcc_billing_invoice i
        JOIN fmcc_billing_provider_payment p ON p.tenant_id=i.tenant_id
          AND p.invoice_id=i.id AND p.gateway_account_id=i.gateway_account_id
        JOIN fmcc_billing_gateway_account g ON g.tenant_id=i.tenant_id
          AND g.id=i.gateway_account_id
        JOIN fmcc_billing_customer c ON c.tenant_id=i.tenant_id AND c.id=i.customer_id
        JOIN fmcc_billing_subscription s ON s.tenant_id=i.tenant_id
          AND s.id=i.subscription_id AND s.product_id=i.product_id AND s.customer_id=i.customer_id
        JOIN fmcc_product_definition product ON product.tenant_id=i.tenant_id AND product.id=i.product_id
        WHERE i.tenant_id=$1 AND i.product_id=$2 AND i.id=$3
          AND product.slug='iron' AND product.status='active'
          AND g.provider='asaas' AND g.environment='production'
          AND g.secret_ref=$4
      `, [tenantId, productId, invoiceId, ASAAS_PRODUCTION_SECRET_REF]);
      if (rows.length !== 1) return null;
      const row = rows[0];
      const amountMinor = Number(row.amount_minor);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
          !/^pay_[A-Za-z0-9_-]{1,128}$/.test(row.external_payment_id) ||
          !/^cus_[A-Za-z0-9_-]{1,128}$/.test(row.external_customer_id)) return null;
      return {
        tenantId: row.tenant_id, productId: row.product_id, invoiceId: row.invoice_id,
        subscriptionId: row.subscription_id, gatewayAccountId: row.gateway_account_id,
        paymentId: row.external_payment_id, customerId: row.external_customer_id, amountMinor,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Uses a single transaction for the reconciled financial state, audit and
   * outbox event. If any step fails, no payment/license event is committed.
   * This method does not contact Asaas or IRON while holding DB locks.
   */
  async commitVerified(
    context: TenantContext,
    binding: CanonicalAsaasIronPaymentBinding,
    payment: VerifiedAsaasPayment,
  ): Promise<{ invoiceId: string; eventId: string; eventType: IronLicenseEvent; inserted: boolean }> {
    if (context.tenantId !== binding.tenantId ||
        payment.id !== binding.paymentId || payment.customer !== binding.customerId ||
        payment.valueMinor !== binding.amountMinor ||
        payment.externalReference !== ironAsaasInvoiceReference(binding.invoiceId)) {
      throw new Error("billing.iron_asaas_scope_mismatch");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{
        subscription_id: string; external_payment_id: string; external_customer_id: string;
        amount_minor: string; invoice_status: string; payment_status: string;
        subscription_status: string; plan_code: string; created_at: Date;
        gateway_status: string; route_status: string | null;
      }>(`
        SELECT i.subscription_id,p.external_payment_id,c.external_customer_id,
          i.amount_minor::text,i.status AS invoice_status,p.status AS payment_status,
          s.status AS subscription_status,s.plan_code,i.created_at,
          g.status AS gateway_status,r.status AS route_status
        FROM fmcc_billing_invoice i
        JOIN fmcc_billing_provider_payment p ON p.tenant_id=i.tenant_id
          AND p.invoice_id=i.id AND p.gateway_account_id=i.gateway_account_id
        JOIN fmcc_billing_subscription s ON s.tenant_id=i.tenant_id AND s.id=i.subscription_id
          AND s.product_id=i.product_id AND s.customer_id=i.customer_id
        JOIN fmcc_billing_customer c ON c.tenant_id=i.tenant_id AND c.id=i.customer_id
        JOIN fmcc_billing_gateway_account g ON g.tenant_id=i.tenant_id AND g.id=i.gateway_account_id
        LEFT JOIN fmcc_billing_product_route r ON r.tenant_id=i.tenant_id AND r.product_id=i.product_id
          AND r.gateway_account_id=i.gateway_account_id
        JOIN fmcc_product_definition product ON product.tenant_id=i.tenant_id
          AND product.id=i.product_id
        WHERE i.tenant_id=$1 AND i.product_id=$2 AND i.id=$3
          AND i.gateway_account_id=$4 AND i.subscription_id=$5
          AND product.slug='iron' AND product.status='active'
          AND g.provider='asaas' AND g.environment='production'
          AND g.secret_ref=$6
        FOR UPDATE OF i,p,s
      `, [
        binding.tenantId,binding.productId,binding.invoiceId,
        binding.gatewayAccountId,binding.subscriptionId,ASAAS_PRODUCTION_SECRET_REF,
      ]);
      if (rows.length !== 1) throw new Error("billing.iron_asaas_locked_binding_missing");
      const row = rows[0];
      if (row.external_payment_id !== binding.paymentId ||
          row.external_customer_id !== binding.customerId ||
          Number(row.amount_minor) !== binding.amountMinor ||
          row.subscription_id !== binding.subscriptionId) {
        throw new Error("billing.iron_asaas_locked_binding_changed");
      }

      const sources = await client.query<{ config: Record<string, unknown> }>(`
        SELECT config FROM fmcc_source_definition
        WHERE tenant_id=$1 AND product_id=$2 AND name='IRON FIT CORE Commercial'
          AND source_type='iron-commercial-v1' AND authoritative_domain='commercial'
          AND secret_ref='env:FMCC_IRON_CONTROL_PLANE_TOKEN'
      `, [binding.tenantId, binding.productId]);
      if (sources.rowCount !== 1) throw new Error("billing.iron_asaas_source_not_canonical");
      const mapping = resolveIronPlanMapping(sources.rows[0].config, row.plan_code);
      if (row.created_at.getTime() < new Date(mapping.effectiveFrom).getTime()) {
        throw new Error("billing.iron_asaas_mapping_not_effective");
      }

      let eventType: IronLicenseEvent;
      if (payment.status === "RECEIVED") {
        if (row.gateway_status !== "enabled" || row.route_status !== "enabled") {
          throw new Error("billing.iron_asaas_gateway_not_active");
        }
        // A previous refund is terminal; a stale RECEIVED GET cannot resurrect.
        if (row.payment_status === "refunded" || row.invoice_status === "refunded" ||
            row.subscription_status === "past_due" || row.subscription_status === "cancelled") {
          throw new Error("billing.iron_asaas_paid_after_reversal_denied");
        }
        if (!["pending", "payment_pending", "paid"].includes(row.invoice_status) ||
            !["pending", "received"].includes(row.payment_status) ||
            !["pending", "active"].includes(row.subscription_status)) {
          throw new Error("billing.iron_asaas_payment_state_conflict");
        }
        eventType = "LICENSE_ACTIVATE";
        await client.query(`
          UPDATE fmcc_billing_provider_payment SET status='received'
          WHERE tenant_id=$1 AND invoice_id=$2 AND gateway_account_id=$3 AND external_payment_id=$4
        `, [binding.tenantId,binding.invoiceId,binding.gatewayAccountId,binding.paymentId]);
        await client.query(`UPDATE fmcc_billing_invoice SET status='paid'
          WHERE tenant_id=$1 AND id=$2 AND product_id=$3`, [binding.tenantId,binding.invoiceId,binding.productId]);
        await client.query(`UPDATE fmcc_billing_subscription SET status='active'
          WHERE tenant_id=$1 AND id=$2 AND product_id=$3`, [binding.tenantId,binding.subscriptionId,binding.productId]);
      } else if (payment.status === "REFUNDED") {
        // Never claim a refund for an unpaid license. Refunds are reversible
        // financial events: suspend for review, do not destroy tenant rights.
        if (row.invoice_status === "refunded" && row.payment_status === "refunded" &&
            row.subscription_status === "past_due") {
          eventType = "LICENSE_SUSPEND";
        } else if (row.invoice_status === "paid" && row.payment_status === "received" &&
                   row.subscription_status === "active") {
          eventType = "LICENSE_SUSPEND";
          await client.query(`UPDATE fmcc_billing_provider_payment SET status='refunded'
            WHERE tenant_id=$1 AND invoice_id=$2 AND gateway_account_id=$3 AND external_payment_id=$4
          `, [binding.tenantId,binding.invoiceId,binding.gatewayAccountId,binding.paymentId]);
          await client.query(`UPDATE fmcc_billing_invoice SET status='refunded'
            WHERE tenant_id=$1 AND id=$2 AND product_id=$3
          `, [binding.tenantId,binding.invoiceId,binding.productId]);
          await client.query(`UPDATE fmcc_billing_subscription SET status='past_due'
            WHERE tenant_id=$1 AND id=$2 AND product_id=$3
          `, [binding.tenantId,binding.subscriptionId,binding.productId]);
        } else {
          throw new Error("billing.iron_asaas_refund_state_requires_review");
        }
      } else {
        throw new Error("billing.iron_asaas_unhandled_state");
      }

      const dedupe = outboxDedupeKey(binding.invoiceId, binding.subscriptionId, eventType);
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO fmcc_billing_iron_entitlement_outbox
          (tenant_id,product_id,invoice_id,subscription_id,event_type,idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id,product_id,idempotency_key) DO NOTHING RETURNING id
      `, [binding.tenantId,binding.productId,binding.invoiceId,binding.subscriptionId,eventType,dedupe]);
      const created = inserted.rowCount === 1;
      const stored = created ? inserted : await client.query<{ id: string }>(`
        SELECT id FROM fmcc_billing_iron_entitlement_outbox
        WHERE tenant_id=$1 AND product_id=$2 AND idempotency_key=$3
      `, [binding.tenantId,binding.productId,dedupe]);
      if (stored.rowCount !== 1) throw new Error("billing.iron_asaas_outbox_invariant");

      await client.query(`
        INSERT INTO fmcc_billing_audit_event
          (tenant_id,actor_id,action,subject_id,correlation_id)
        VALUES ($1,$2,$3,$4,$5)
      `, [binding.tenantId,context.userId,
        payment.status === "RECEIVED" ? "iron.asaas.received_reconciled" : "iron.asaas.refund_reconciled",
        binding.invoiceId,context.correlationId]);
      await client.query("COMMIT");
      return { invoiceId: binding.invoiceId, eventId: stored.rows[0].id, eventType, inserted: created };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
