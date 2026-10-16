import pg from "pg";

/** PostgreSQL is the canonical authority; never use an ephemeral database for live issuance. */
export class ProductionPilotLedger {
 constructor(private readonly pool: pg.Pool) {}
 async reserve(input:{tenantId:string;invoiceId:string;gatewayAccountId:string}):Promise<boolean>{
  const r=await this.pool.query(
   `UPDATE fmcc_billing_invoice i SET status='creating'
      WHERE i.tenant_id=$1 AND i.id=$2 AND i.gateway_account_id=$3
        AND i.status='pending' AND i.amount_minor=100 AND i.currency='BRL'
        AND NOT EXISTS(SELECT 1 FROM fmcc_billing_provider_payment p WHERE p.tenant_id=i.tenant_id AND p.invoice_id=i.id)
        AND EXISTS(SELECT 1 FROM fmcc_billing_gateway_account g
            WHERE g.tenant_id=i.tenant_id AND g.id=i.gateway_account_id
              AND g.provider='asaas' AND g.environment='production' AND g.status='enabled')
      RETURNING i.id`,[input.tenantId,input.invoiceId,input.gatewayAccountId]);
  return r.rowCount===1;
 }
 async releaseAfterProviderRejection(input:{tenantId:string;invoiceId:string;gatewayAccountId:string}):Promise<boolean>{
  return this.releaseCreatingClaim(input);
 }
 async releaseAfterVerifiedProviderAbsence(input:{tenantId:string;invoiceId:string;gatewayAccountId:string}):Promise<boolean>{
  return this.releaseCreatingClaim(input);
 }
 private async releaseCreatingClaim(input:{tenantId:string;invoiceId:string;gatewayAccountId:string}):Promise<boolean>{
  const r=await this.pool.query(
   `UPDATE fmcc_billing_invoice i SET status='pending'
      WHERE i.tenant_id=$1 AND i.id=$2 AND i.gateway_account_id=$3
        AND i.status='creating' AND i.amount_minor=100 AND i.currency='BRL'
        AND NOT EXISTS(
          SELECT 1 FROM fmcc_billing_provider_payment p
          WHERE p.tenant_id=i.tenant_id AND p.invoice_id=i.id
        )
        AND EXISTS(
          SELECT 1 FROM fmcc_billing_gateway_account g
          WHERE g.tenant_id=i.tenant_id AND g.id=i.gateway_account_id
            AND g.provider='asaas' AND g.environment='production' AND g.status='enabled'
        )
      RETURNING i.id`,
   [input.tenantId,input.invoiceId,input.gatewayAccountId]);
  return r.rowCount===1;
 }
 async recoverProviderPayment(input:{tenantId:string;invoiceId:string;gatewayAccountId:string;externalPaymentId:string;status:string}):Promise<"recovered"|"already_recorded">{
  const client=await this.pool.connect();
  try {
   await client.query("BEGIN");
   const invoice=await client.query(
    `SELECT i.id,i.status FROM fmcc_billing_invoice i
     JOIN fmcc_billing_gateway_account g ON g.tenant_id=i.tenant_id AND g.id=i.gateway_account_id
     WHERE i.tenant_id=$1 AND i.id=$2 AND i.gateway_account_id=$3 AND i.amount_minor=100
     AND i.currency='BRL' AND g.provider='asaas' AND g.environment='production'
     AND i.status IN ('creating','payment_pending','paid') FOR UPDATE OF i`,
    [input.tenantId,input.invoiceId,input.gatewayAccountId]);
   if(invoice.rowCount!==1)throw new Error("billing.production_recovery_scope_denied");
   const existing=await client.query(
    "SELECT external_payment_id FROM fmcc_billing_provider_payment WHERE tenant_id=$1 AND invoice_id=$2 FOR UPDATE",
    [input.tenantId,input.invoiceId]);
   if(existing.rowCount){
    if(existing.rows[0].external_payment_id!==input.externalPaymentId)throw new Error("billing.production_recovery_conflict");
    await client.query("COMMIT");
    return "already_recorded";
   }
   if(invoice.rows[0].status!=="creating")throw new Error("billing.production_recovery_state_invalid");
   await client.query("INSERT INTO fmcc_billing_provider_payment (tenant_id,invoice_id,gateway_account_id,external_payment_id,status) VALUES ($1,$2,$3,$4,$5)",
    [input.tenantId,input.invoiceId,input.gatewayAccountId,input.externalPaymentId,input.status]);
   await client.query("UPDATE fmcc_billing_invoice SET status='payment_pending' WHERE tenant_id=$1 AND id=$2",
    [input.tenantId,input.invoiceId]);
   await client.query("COMMIT");
   return "recovered";
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
 }
 async markProviderConfirmed(input:{tenantId:string;invoiceId:string;gatewayAccountId:string;externalPaymentId:string}):Promise<void>{
  const client=await this.pool.connect();
  try {
   await client.query("BEGIN");
   const match=await client.query(
    `SELECT i.id FROM fmcc_billing_invoice i
     JOIN fmcc_billing_gateway_account g ON g.tenant_id=i.tenant_id AND g.id=i.gateway_account_id
     JOIN fmcc_billing_provider_payment p ON p.tenant_id=i.tenant_id AND p.invoice_id=i.id AND p.gateway_account_id=i.gateway_account_id
     WHERE i.tenant_id=$1 AND i.id=$2 AND i.gateway_account_id=$3 AND p.external_payment_id=$4
       AND i.amount_minor=100 AND i.currency='BRL' AND g.environment='production' AND g.provider='asaas'
       AND i.status IN ('payment_pending','paid') FOR UPDATE OF i,p`,
    [input.tenantId,input.invoiceId,input.gatewayAccountId,input.externalPaymentId]);
   if(match.rowCount!==1)throw new Error("billing.production_reconciliation_scope_denied");
   await client.query("UPDATE fmcc_billing_provider_payment SET status='received' WHERE tenant_id=$1 AND invoice_id=$2 AND gateway_account_id=$3 AND external_payment_id=$4",
    [input.tenantId,input.invoiceId,input.gatewayAccountId,input.externalPaymentId]);
   await client.query("UPDATE fmcc_billing_invoice SET status='paid' WHERE tenant_id=$1 AND id=$2 AND gateway_account_id=$3",
    [input.tenantId,input.invoiceId,input.gatewayAccountId]);
   await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
 }
 async persistProviderPayment(input:{tenantId:string;invoiceId:string;gatewayAccountId:string;externalPaymentId:string;status:string}):Promise<void>{
  const client=await this.pool.connect();
  try {
   await client.query("BEGIN");
   const invoice=await client.query(
    "SELECT id FROM fmcc_billing_invoice WHERE tenant_id=$1 AND id=$2 AND gateway_account_id=$3 AND status='creating' AND amount_minor=100 FOR UPDATE",
    [input.tenantId,input.invoiceId,input.gatewayAccountId]);
   if(invoice.rowCount!==1)throw new Error("billing.production_claim_missing");
   await client.query("INSERT INTO fmcc_billing_provider_payment (tenant_id,invoice_id,gateway_account_id,external_payment_id,status) VALUES ($1,$2,$3,$4,$5)",
    [input.tenantId,input.invoiceId,input.gatewayAccountId,input.externalPaymentId,input.status]);
   await client.query("UPDATE fmcc_billing_invoice SET status='payment_pending' WHERE tenant_id=$1 AND id=$2",
    [input.tenantId,input.invoiceId]);
   await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
 }
}
