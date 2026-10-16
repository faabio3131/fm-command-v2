import {describe,it,expect,beforeAll,afterAll} from "vitest";
import pg from "pg";
import {randomUUID} from "node:crypto";
import {ProductionPilotLedger} from "../src/infrastructure/billing/production-pilot-ledger";

const tenant="ci-recovery-"+randomUUID();
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4,idleTimeoutMillis:1000,allowExitOnIdle:true});
const ledger=new ProductionPilotLedger(pool);
let invoiceId:string,gatewayAccountId:string;
const binding=()=>({tenantId:tenant,invoiceId,gatewayAccountId});
describe("Production payment recovery and reconciliation on real PostgreSQL",()=>{
 beforeAll(async()=>{
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  const localIsolated = !!url &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    ["5432", "55449"].includes(url.port) &&
    url.pathname === "/fmcc_billing_ci" &&
    url.username === "fmcc_restore_test";
  const githubIsolated = !!url &&
    process.env.CI === "true" &&
    process.env.NODE_ENV === "test" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.port === "5432" &&
    url.pathname === "/fmcc" &&
    url.username === "postgres";
  if (!localIsolated && !githubIsolated)
    throw Error("billing.test_requires_isolated_local_pg");
  const product=await pool.query("INSERT INTO fmcc_product_definition(tenant_id,slug,name) VALUES($1,$2,'Kordena') RETURNING id",[tenant,tenant]);
  const customer=await pool.query("INSERT INTO fmcc_billing_customer(tenant_id,external_customer_id) VALUES($1,'test-customer') RETURNING id",[tenant]);
  const gateway=await pool.query("INSERT INTO fmcc_billing_gateway_account(tenant_id,provider,environment,label,secret_ref,status) VALUES($1,'asaas','production','ci','env://FMCC_ASAAS_PRODUCTION_API_KEY','enabled') RETURNING id",[tenant]);
  gatewayAccountId=gateway.rows[0].id;
  const sub=await pool.query("INSERT INTO fmcc_billing_subscription(tenant_id,product_id,customer_id,plan_code) VALUES($1,$2,$3,'ci-pilot') RETURNING id",[tenant,product.rows[0].id,customer.rows[0].id]);
  const inv=await pool.query("INSERT INTO fmcc_billing_invoice(tenant_id,product_id,customer_id,subscription_id,gateway_account_id,amount_minor,currency) VALUES($1,$2,$3,$4,$5,100,'BRL') RETURNING id",[tenant,product.rows[0].id,customer.rows[0].id,sub.rows[0].id,gatewayAccountId]);
  invoiceId=inv.rows[0].id;
 });
 afterAll(async()=>{
  try {
   if(invoiceId){
   await pool.query("DELETE FROM fmcc_billing_provider_payment WHERE tenant_id=$1",[tenant]);
   await pool.query("DELETE FROM fmcc_billing_invoice WHERE tenant_id=$1",[tenant]);
   await pool.query("DELETE FROM fmcc_billing_subscription WHERE tenant_id=$1",[tenant]);
   await pool.query("DELETE FROM fmcc_billing_gateway_account WHERE tenant_id=$1",[tenant]);
   await pool.query("DELETE FROM fmcc_billing_customer WHERE tenant_id=$1",[tenant]);
   await pool.query("DELETE FROM fmcc_product_definition WHERE tenant_id=$1",[tenant]);
  }
  } finally { await pool.end(); }
 });
 it("reserves only once, recovers uncertain charge, and refuses conflicting payment IDs",async()=>{
  expect(await ledger.reserve(binding())).toBe(true);
  expect(await ledger.reserve(binding())).toBe(false);
  expect(await ledger.recoverProviderPayment({...binding(),externalPaymentId:"pay_ci_recovery",status:"PENDING"})).toBe("recovered");
  expect(await ledger.recoverProviderPayment({...binding(),externalPaymentId:"pay_ci_recovery",status:"PENDING"})).toBe("already_recorded");
  await expect(ledger.recoverProviderPayment({...binding(),externalPaymentId:"pay_ci_conflict",status:"PENDING"})).rejects.toThrow("recovery_conflict");
  expect(await ledger.reserve(binding())).toBe(false);
 });
 it("rejects mismatched tenant and confirms atomically for correct binding",async()=>{
  await expect(ledger.markProviderConfirmed({...binding(),tenantId:"wrong-tenant",externalPaymentId:"pay_ci_recovery"})).rejects.toThrow("scope_denied");
  await ledger.markProviderConfirmed({...binding(),externalPaymentId:"pay_ci_recovery"});
  const result=await pool.query("SELECT i.status invoice_status,p.status payment_status FROM fmcc_billing_invoice i JOIN fmcc_billing_provider_payment p ON p.tenant_id=i.tenant_id AND p.invoice_id=i.id WHERE i.tenant_id=$1 AND i.id=$2",[tenant,invoiceId]);
  expect(result.rows[0]).toMatchObject({invoice_status:"paid",payment_status:"received"});
  await ledger.markProviderConfirmed({...binding(),externalPaymentId:"pay_ci_recovery"});
  expect(await ledger.reserve(binding())).toBe(false);
 });
});
