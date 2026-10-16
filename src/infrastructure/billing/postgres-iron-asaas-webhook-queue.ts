import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type ClaimedIronWebhook = {
  id:string;tenantId:string;productId:string;invoiceId:string;
  eventId:string;eventType:"PAYMENT_RECEIVED"|"PAYMENT_REFUNDED";
  paymentId:string;reference:string;claimToken:string;
};

export class PostgresIronAsaasWebhookQueue {
  constructor(private readonly database: Pick<Pool,"query">) {}

  async claimOne(tenantId:string):Promise<ClaimedIronWebhook|null> {
    if (!tenantId || tenantId.length>128) throw new Error("billing.iron_webhook_scope_invalid");
    const claimToken=randomUUID();
    const result=await this.database.query<{
      id:string;tenant_id:string;product_id:string;invoice_id:string;
      external_event_id:string;event_type:ClaimedIronWebhook["eventType"];
      external_payment_id:string;external_reference:string;
    }>(`
      WITH candidate AS (
        SELECT e.id,i.product_id,i.id AS invoice_id
        FROM fmcc_billing_gateway_event e
        JOIN fmcc_billing_gateway_account g ON g.tenant_id=e.tenant_id AND g.id=e.gateway_account_id
        JOIN fmcc_billing_invoice i ON i.tenant_id=e.tenant_id
          AND i.gateway_account_id=e.gateway_account_id
          AND e.external_reference='fmcc-iron-' || i.id::text
        JOIN fmcc_product_definition product ON product.tenant_id=i.tenant_id AND product.id=i.product_id
        WHERE e.tenant_id=$1 AND product.slug='iron' AND product.status='active'
          AND g.provider='asaas' AND g.environment='production'
          AND g.secret_ref='env://FMCC_ASAAS_PRODUCTION_API_KEY'
          AND e.event_type IN ('PAYMENT_RECEIVED','PAYMENT_REFUNDED')
          AND e.attempts<12
          AND ((e.status IN ('received','retry') AND e.available_at<=now())
            OR (e.status='processing' AND e.lease_until<now()))
          AND NOT EXISTS (
            SELECT 1 FROM fmcc_billing_gateway_event older
            WHERE older.tenant_id=e.tenant_id AND older.gateway_account_id=e.gateway_account_id
              AND older.external_reference=e.external_reference
              AND (older.received_at,older.id)<(e.received_at,e.id)
              AND older.status IN ('received','retry','processing')
          )
        ORDER BY e.received_at,e.id LIMIT 1 FOR UPDATE OF e SKIP LOCKED
      )
      UPDATE fmcc_billing_gateway_event e SET
        status='processing',attempts=e.attempts+1,claim_token=$2,
        lease_until=now()+interval '90 seconds',updated_at=now()
      FROM candidate WHERE e.id=candidate.id AND e.tenant_id=$1
      RETURNING e.id,e.tenant_id,candidate.product_id,candidate.invoice_id,
        e.external_event_id,e.event_type,e.external_payment_id,e.external_reference
    `,[tenantId,claimToken]);
    if (result.rowCount!==1) return null;
    const e=result.rows[0];
    return {
      id:e.id,tenantId:e.tenant_id,productId:e.product_id,invoiceId:e.invoice_id,
      eventId:e.external_event_id,eventType:e.event_type,paymentId:e.external_payment_id,
      reference:e.external_reference,claimToken,
    };
  }

  async acknowledge(item:ClaimedIronWebhook):Promise<boolean>{
    const result=await this.database.query(`
      UPDATE fmcc_billing_gateway_event SET status='processed',processed_at=now(),
        claim_token=NULL,lease_until=NULL,last_error_code=NULL,updated_at=now()
      WHERE id=$1 AND tenant_id=$2 AND claim_token=$3
        AND status='processing' AND lease_until>now()
    `,[item.id,item.tenantId,item.claimToken]);
    return result.rowCount===1;
  }

  async fail(item:ClaimedIronWebhook,code:string,permanent:boolean):Promise<boolean>{
    if(!/^[A-Z0-9_]{3,80}$/.test(code))throw new Error("billing.iron_webhook_error_code_invalid");
    const result=await this.database.query(`
      UPDATE fmcc_billing_gateway_event SET
        status=CASE WHEN $4 OR attempts>=12 THEN 'blocked' ELSE 'retry' END,
        available_at=now()+make_interval(secs => LEAST(3600,(power(2,LEAST(attempts,10))::integer)*5)),
        claim_token=NULL,lease_until=NULL,last_error_code=$5,updated_at=now()
      WHERE id=$1 AND tenant_id=$2 AND claim_token=$3
        AND status='processing' AND lease_until>now()
    `,[item.id,item.tenantId,item.claimToken,permanent,code]);
    return result.rowCount===1;
  }
}
