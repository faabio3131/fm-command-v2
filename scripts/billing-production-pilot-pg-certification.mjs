import assert from "node:assert/strict";
import pg from "pg";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
const tenant="pilot-cert";
try {
 const product=await pool.query("INSERT INTO fmcc_product_definition(tenant_id,slug,name) VALUES($1,'real-pilot-cert','Kordena CI') RETURNING id",[tenant]);
 const customer=await pool.query("INSERT INTO fmcc_billing_customer(tenant_id,external_customer_id) VALUES($1,'pilot-test') RETURNING id",[tenant]);
 const gateway=await pool.query("INSERT INTO fmcc_billing_gateway_account(tenant_id,provider,environment,label,secret_ref,status) VALUES($1,'asaas','production','ci','env://FMCC_ASAAS_PRODUCTION_API_KEY','enabled') RETURNING id",[tenant]);
 const subscription=await pool.query("INSERT INTO fmcc_billing_subscription(tenant_id,product_id,customer_id,plan_code) VALUES($1,$2,$3,'ci-pilot') RETURNING id",[tenant,product.rows[0].id,customer.rows[0].id]);
 const invoice=await pool.query("INSERT INTO fmcc_billing_invoice(tenant_id,product_id,customer_id,subscription_id,gateway_account_id,amount_minor,currency) VALUES($1,$2,$3,$4,$5,100,'BRL') RETURNING id",[tenant,product.rows[0].id,customer.rows[0].id,subscription.rows[0].id,gateway.rows[0].id]);
 const reserveSql=`UPDATE fmcc_billing_invoice i SET status='creating' WHERE i.tenant_id=$1 AND i.id=$2 AND i.gateway_account_id=$3 AND i.status='pending' AND i.amount_minor=100 AND i.currency='BRL' AND NOT EXISTS(SELECT 1 FROM fmcc_billing_provider_payment p WHERE p.tenant_id=i.tenant_id AND p.invoice_id=i.id) AND EXISTS(SELECT 1 FROM fmcc_billing_gateway_account g WHERE g.tenant_id=i.tenant_id AND g.id=i.gateway_account_id AND g.provider='asaas' AND g.environment='production' AND g.status='enabled') RETURNING i.id`;
 const vals=[tenant,invoice.rows[0].id,gateway.rows[0].id];
 const competing=await Promise.all([pool.query(reserveSql,vals),pool.query(reserveSql,vals)]);
 assert.deepEqual(competing.map(r=>r.rowCount).sort(),[0,1],"Second execution claimed same real invoice");
 await pool.query("INSERT INTO fmcc_billing_provider_payment(tenant_id,invoice_id,gateway_account_id,external_payment_id,status) VALUES($1,$2,$3,'pay-pilot-fixture','pending')",vals);
 const retry=await pool.query(reserveSql,vals);
 assert.equal(retry.rowCount,0);
 const existing=await pool.query("SELECT count(*)::int AS n FROM fmcc_billing_provider_payment WHERE tenant_id=$1 AND invoice_id=$2",[tenant,invoice.rows[0].id]);
 assert.equal(existing.rows[0].n,1);
 console.log("PASS: PostgreSQL 18 persistent production invoice rejects concurrent second claim and later retry");
}finally{
 await pool.query("DELETE FROM fmcc_billing_provider_payment WHERE tenant_id=$1",[tenant]);
 await pool.query("DELETE FROM fmcc_billing_invoice WHERE tenant_id=$1",[tenant]);
 await pool.query("DELETE FROM fmcc_billing_subscription WHERE tenant_id=$1",[tenant]);
 await pool.query("DELETE FROM fmcc_billing_gateway_account WHERE tenant_id=$1",[tenant]);
 await pool.query("DELETE FROM fmcc_billing_customer WHERE tenant_id=$1",[tenant]);
 await pool.query("DELETE FROM fmcc_product_definition WHERE tenant_id=$1",[tenant]);
 await pool.end();
}
