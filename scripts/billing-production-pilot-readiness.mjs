import assert from "node:assert/strict";
import pg from "pg";

export const PILOT_INVOICE_ID="a51a5000-1990-4000-8000-000000000001";
export const PILOT_REFERENCE="fmcc-kordena-real-pix-001-20261008";
export function assertPersistentDatabase(url){
 if(!url || !/^postgres(?:ql)?:\/\//.test(url))throw Error("billing.production_database_missing");
 const target=new URL(url);
 if(["localhost","127.0.0.1","::1","postgres"].includes(target.hostname) ||
    /(?:_ci|preflight|test|ephemeral)/i.test(target.pathname))
  throw Error("billing.production_database_not_persistent");
}
export async function inspectPilotInvoice(db){
 const {rows}=await db.query(`SELECT i.id, i.status, i.tenant_id, i.amount_minor, i.currency,
  i.product_id,i.customer_id,i.subscription_id,i.gateway_account_id,
  g.provider,g.environment,g.status gateway_status,g.secret_ref,
  p.id payment_id,
  d.name product_name
  FROM fmcc_billing_invoice i
  JOIN fmcc_billing_gateway_account g ON g.id=i.gateway_account_id AND g.tenant_id=i.tenant_id
  JOIN fmcc_product_definition d ON d.id=i.product_id AND d.tenant_id=i.tenant_id
  LEFT JOIN fmcc_billing_provider_payment p ON p.tenant_id=i.tenant_id AND p.invoice_id=i.id
  WHERE i.id=$1`,[PILOT_INVOICE_ID]);
 if(rows.length!==1)throw Error("billing.production_pilot_invoice_not_provisioned");
 const r=rows[0];
 if(r.status!=="pending" || Number(r.amount_minor)!==100 || r.currency!=="BRL" ||
    r.provider!=="asaas" || r.environment!=="production" || r.gateway_status!=="enabled" ||
    r.secret_ref!=="env://FMCC_ASAAS_PRODUCTION_API_KEY" ||
    !/kordena/i.test(r.product_name) || r.payment_id)
  throw Error("billing.production_pilot_scope_not_ready");
 return {invoiceId:r.id,tenantId:r.tenant_id,productId:r.product_id,customerId:r.customer_id,subscriptionId:r.subscription_id,gatewayAccountId:r.gateway_account_id,amountMinor:100,environment:"production",status:r.status};
}
if(process.argv[1] && import.meta.url===new URL("file://"+process.argv[1].replaceAll("\\","/")).href){
 if(process.env.FMCC_PILOT_READ_ONLY!=="CONFIRM_READ_ONLY" || process.env.FMCC_PILOT_BACKUP_VERIFIED!=="YES")
  throw Error("billing.production_pilot_readiness_approval_missing");
 assertPersistentDatabase(process.env.DATABASE_URL);
 const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:6000});
 await db.connect();
 try{const result=await inspectPilotInvoice(db);assert.equal(result.amountMinor,100);console.log(JSON.stringify({result:"PILOT_READINESS_PASS",invoiceId:result.invoiceId,environment:result.environment,amountMinor:100}));}
 finally{await db.end();}
}
