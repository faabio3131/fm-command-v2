import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  PostgresIronAsaasAtomicReconciliation,
} from "@/infrastructure/billing/postgres-iron-asaas-atomic-reconciliation";
import { ironAsaasInvoiceReference } from "@/infrastructure/billing/asaas-iron-payment-readonly-client";
import { PostgresIronAsaasWebhookQueue } from "@/infrastructure/billing/postgres-iron-asaas-webhook-queue";

const enabled = process.env.FMCC_IRON_ASAAS_PG_TEST === "YES";
const tenantId = "ci-iron-atomic-" + randomUUID();
const otherTenant = "ci-iron-other-" + randomUUID();
const paymentId = "pay_ci_atomic_" + randomUUID().replace(/-/g, "");
const customerId = "cus_ci_atomic_" + randomUUID().replace(/-/g, "");
let productId = "", invoiceId = "", subscriptionId = "", gatewayAccountId = "";
let pool: pg.Pool;
let repository: PostgresIronAsaasAtomicReconciliation;

const asPayment = (status: "RECEIVED" | "REFUNDED") => ({
  id: paymentId, customer: customerId,
  externalReference: ironAsaasInvoiceReference(invoiceId),
  valueMinor: 1990, billingType: "PIX" as const, status,
});
const ctx = () => ({ tenantId, userId: "ci-operator", role: "owner" as const, correlationId: "ci-atomic-proof" });

describe.skipIf(!enabled)("D11 real disposable PG: financial state and license event commit together", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    repository = new PostgresIronAsaasAtomicReconciliation(pool);
    const p = await pool.query<{ id: string }>(`
      INSERT INTO fmcc_product_definition (tenant_id,slug,name)
      VALUES ($1,'iron','IRON atomic CI') RETURNING id
    `, [tenantId]); productId = p.rows[0].id;
    const c = await pool.query<{ id: string }>(`
      INSERT INTO fmcc_billing_customer (tenant_id,external_customer_id)
      VALUES ($1,$2) RETURNING id
    `, [tenantId,customerId]);
    const g = await pool.query<{ id: string }>(`
      INSERT INTO fmcc_billing_gateway_account
        (tenant_id,provider,environment,label,secret_ref,status)
      VALUES ($1,'asaas','production','ci-readonly','env://FMCC_ASAAS_PRODUCTION_API_KEY','enabled')
      RETURNING id
    `, [tenantId]); gatewayAccountId = g.rows[0].id;
    await pool.query(`
      INSERT INTO fmcc_billing_product_route (tenant_id,product_id,gateway_account_id,status)
      VALUES ($1,$2,$3,'enabled')
    `, [tenantId,productId,gatewayAccountId]);
    const s = await pool.query<{ id: string }>(`
      INSERT INTO fmcc_billing_subscription (tenant_id,product_id,customer_id,plan_code,status)
      VALUES ($1,$2,$3,'IRON_MONTHLY','pending') RETURNING id
    `, [tenantId,productId,c.rows[0].id]); subscriptionId = s.rows[0].id;
    const i = await pool.query<{ id: string }>(`
      INSERT INTO fmcc_billing_invoice
        (tenant_id,product_id,customer_id,subscription_id,gateway_account_id,amount_minor,status)
      VALUES ($1,$2,$3,$4,$5,1990,'payment_pending') RETURNING id
    `, [tenantId,productId,c.rows[0].id,subscriptionId,gatewayAccountId]); invoiceId = i.rows[0].id;
    await pool.query(`
      INSERT INTO fmcc_billing_provider_payment
        (tenant_id,invoice_id,gateway_account_id,external_payment_id,status)
      VALUES ($1,$2,$3,$4,'pending')
    `, [tenantId,invoiceId,gatewayAccountId,paymentId]);
    await pool.query(`
      INSERT INTO fmcc_source_definition
        (tenant_id,product_id,name,source_type,authoritative_domain,
         sync_mode,secret_ref,config)
      VALUES ($1,$2,'IRON FIT CORE Commercial','iron-commercial-v1',
              'commercial','pull','env:FMCC_IRON_CONTROL_PLANE_TOKEN',$3::jsonb)
    `, [tenantId,productId,JSON.stringify({
      ironCommercialPlanMappings: {
        schemaVersion: "iron.commercial-plan-mappings.v1",
        mappings: [{
          revision: 1, commercialPlanCode: "IRON_MONTHLY",
          ironPlanCode: "IRON_PRO", ironPlanVersion: 1,
          effectiveFrom: "2026-01-01T00:00:00.000Z",
        }],
      },
    })]);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM fmcc_billing_iron_entitlement_outbox WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_billing_audit_event WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_billing_gateway_event WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_billing_provider_payment WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_billing_invoice WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_billing_subscription WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_billing_product_route WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_source_definition WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_billing_gateway_account WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_billing_customer WHERE tenant_id=$1",[tenantId]);
    await pool.query("DELETE FROM fmcc_product_definition WHERE tenant_id=$1",[tenantId]);
    await pool.end();
  });

  it("prevents cross-tenant lookup and incorrect invoice/payment binding", async () => {
    expect(await repository.binding(otherTenant,productId,invoiceId)).toBeNull();
    const binding = await repository.binding(tenantId,productId,invoiceId);
    expect(binding).toMatchObject({
      tenantId,productId,invoiceId,subscriptionId, gatewayAccountId,
      paymentId,customerId,amountMinor:1990,
    });
    await expect(repository.commitVerified(
      { ...ctx(), tenantId: otherTenant }, binding!, asPayment("RECEIVED"),
    )).rejects.toThrow("billing.iron_asaas_scope_mismatch");
    const pre = await pool.query("SELECT status FROM fmcc_billing_invoice WHERE id=$1",[invoiceId]);
    expect(pre.rows[0].status).toBe("payment_pending");
  });

  it("records RECEIVED, paid invoice, active subscription, audit and outbox atomically", async () => {
    const binding = await repository.binding(tenantId,productId,invoiceId);
    expect(binding).not.toBeNull();
    const outcome = await repository.commitVerified(ctx(),binding!,asPayment("RECEIVED"));
    expect(outcome).toMatchObject({invoiceId,eventType:"LICENSE_ACTIVATE",inserted:true});
    const [invoice,payment,sub,event,audit] = await Promise.all([
      pool.query("SELECT status FROM fmcc_billing_invoice WHERE id=$1",[invoiceId]),
      pool.query("SELECT status FROM fmcc_billing_provider_payment WHERE invoice_id=$1",[invoiceId]),
      pool.query("SELECT status FROM fmcc_billing_subscription WHERE id=$1",[subscriptionId]),
      pool.query("SELECT event_type,status FROM fmcc_billing_iron_entitlement_outbox WHERE tenant_id=$1",[tenantId]),
      pool.query("SELECT action FROM fmcc_billing_audit_event WHERE tenant_id=$1",[tenantId]),
    ]);
    expect(invoice.rows[0].status).toBe("paid");
    expect(payment.rows[0].status).toBe("received");
    expect(sub.rows[0].status).toBe("active");
    expect(event.rows).toMatchObject([{ event_type:"LICENSE_ACTIVATE",status:"pending" }]);
    expect(audit.rows).toHaveLength(1);
    expect((await repository.commitVerified(ctx(),binding!,asPayment("RECEIVED"))).inserted).toBe(false);
    expect((await pool.query(
      "SELECT count(*)::int AS n FROM fmcc_billing_iron_entitlement_outbox WHERE tenant_id=$1",[tenantId]
    )).rows[0].n).toBe(1);
  });

  it("turns full verified REFUNDED into past_due and a distinct SUSPEND event, idempotently", async () => {
    const binding = await repository.binding(tenantId,productId,invoiceId);
    const result = await repository.commitVerified(ctx(),binding!,asPayment("REFUNDED"));
    expect(result).toMatchObject({ eventType:"LICENSE_SUSPEND",inserted:true });
    expect((await repository.commitVerified(ctx(),binding!,asPayment("REFUNDED"))).inserted).toBe(false);
    const q = await pool.query(`
      SELECT i.status AS invoice,s.status AS subscription,p.status AS payment
      FROM fmcc_billing_invoice i JOIN fmcc_billing_subscription s ON s.id=i.subscription_id
      JOIN fmcc_billing_provider_payment p ON p.invoice_id=i.id
      WHERE i.id=$1
    `,[invoiceId]);
    expect(q.rows[0]).toMatchObject({invoice:"refunded",subscription:"past_due",payment:"refunded"});
    const events = await pool.query(`
      SELECT event_type FROM fmcc_billing_iron_entitlement_outbox
      WHERE tenant_id=$1 ORDER BY created_at,id
    `,[tenantId]);
    expect(events.rows.map(r=>r.event_type).sort()).toEqual(["LICENSE_ACTIVATE","LICENSE_SUSPEND"]);
    await expect(repository.commitVerified(ctx(),binding!,asPayment("RECEIVED")))
      .rejects.toThrow("billing.iron_asaas_paid_after_reversal_denied");
    const later = await pool.query("SELECT status FROM fmcc_billing_invoice WHERE id=$1",[invoiceId]);
    expect(later.rows[0].status).toBe("refunded");
  });

  it("fences a real queued webhook in PostgreSQL; no cross-tenant claim, duplicate claim or stale ACK", async () => {
    const queue=new PostgresIronAsaasWebhookQueue(pool);
    const eventId="evt_ci_fenced_"+randomUUID().replace(/-/g,"");
    await pool.query(`
      INSERT INTO fmcc_billing_gateway_event
      (tenant_id,gateway_account_id,external_event_id,status,event_type,external_payment_id,external_reference,payload_fingerprint)
      VALUES ($1,$2,$3,'received','PAYMENT_RECEIVED',$4,$5,$6)
    `,[tenantId,gatewayAccountId,eventId,paymentId,ironAsaasInvoiceReference(invoiceId),"b".repeat(64)]);
    expect(await queue.claimOne(otherTenant)).toBeNull();
    const first=await queue.claimOne(tenantId);
    expect(first).toMatchObject({tenantId,productId,invoiceId,eventId,paymentId});
    expect(await queue.claimOne(tenantId)).toBeNull();
    expect(await queue.acknowledge({...first!,claimToken:randomUUID()})).toBe(false);
    expect(await queue.acknowledge(first!)).toBe(true);
    expect(await queue.acknowledge(first!)).toBe(false);
    expect(await queue.claimOne(tenantId)).toBeNull();
    const status=await pool.query("SELECT status,attempts,claim_token FROM fmcc_billing_gateway_event WHERE external_event_id=$1",[eventId]);
    expect(status.rows[0]).toMatchObject({status:"processed",attempts:1,claim_token:null});
  });

  it("retries with delay and fences stale tokens when the worker fails", async () => {
    const queue=new PostgresIronAsaasWebhookQueue(pool);
    const eventId="evt_ci_retry_"+randomUUID().replace(/-/g,"");
    await pool.query(`
      INSERT INTO fmcc_billing_gateway_event
      (tenant_id,gateway_account_id,external_event_id,status,event_type,external_payment_id,external_reference,payload_fingerprint)
      VALUES ($1,$2,$3,'received','PAYMENT_REFUNDED',$4,$5,$6)
    `,[tenantId,gatewayAccountId,eventId,paymentId,ironAsaasInvoiceReference(invoiceId),"c".repeat(64)]);
    const item=await queue.claimOne(tenantId);
    expect(item?.eventId).toBe(eventId);
    expect(await queue.fail({...item!,claimToken:randomUUID()},"WEBHOOK_PROVIDER_OR_DB_RETRY",false)).toBe(false);
    expect(await queue.fail(item!,"WEBHOOK_PROVIDER_OR_DB_RETRY",false)).toBe(true);
    expect(await queue.claimOne(tenantId)).toBeNull();
    const state=await pool.query("SELECT status,available_at>now() AS delayed FROM fmcc_billing_gateway_event WHERE external_event_id=$1",[eventId]);
    expect(state.rows[0]).toMatchObject({status:"retry",delayed:true});
  });

});
