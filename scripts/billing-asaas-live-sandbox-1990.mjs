import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { preflightProviderInvoice } from "./billing-provider-preflight.mjs";

const key = process.env.FMCC_ASAAS_SANDBOX_API_KEY;
if (!key || process.env.FMCC_ASAAS_LIVE_CONFIRM !== "CREATE_CONFIRM_SANDBOX_1990")
  throw new Error("billing.sandbox_explicit_authorization_required");
if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes("localhost:5432/fmcc_billing_preflight"))
  throw new Error("billing.not_isolated_postgres");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const base = "https://api-sandbox.asaas.com/v3";
const tenant = "fmcc-sandbox-ci";
const id = randomUUID();
const invoiceId = "a51a5000-1990-4000-8000-000000000001";
const amountMinor = 1990;
let paymentId = null;
async function request(method, path, payload) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(base + path, {
      method, redirect:"error", cache:"no-store", signal:controller.signal,
      headers:{ access_token:key,accept:"application/json","content-type":"application/json","user-agent":"FMCommand-Testing/1.0" },
      ...(payload ? {body:JSON.stringify(payload)} : {}),
    });
    if (!response.ok) throw new Error("billing.asaas_http_" + response.status);
    const data = await response.json();
    if (!data || typeof data !== "object") throw new Error("billing.asaas_bad_json");
    return data;
  } finally {clearTimeout(deadline);}
}
function validateCharge(charge) {
  assert.equal(charge.id,paymentId,"Asaas payment ID mismatch");
  assert.equal(charge.externalReference,invoiceId,"Canonical invoice mismatch");
  assert.equal(Math.round(charge.value*100),amountMinor,"Payment amount mismatch");
  assert.equal(charge.billingType,"PIX","Payment method mismatch");
}
await db.connect();
try {
  const state = await db.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
  assert.equal(state.rows[0].n,6);
  const product = await db.query("INSERT INTO fmcc_product_definition (tenant_id,slug,name) VALUES ($1,$2,$3) RETURNING id",[tenant,"kordena-ci-"+id,"Kordena homologacao"]);
  const customer = await db.query("INSERT INTO fmcc_billing_customer (tenant_id,external_customer_id) VALUES ($1,$2) RETURNING id",[tenant,"fictitious-ci-"+id]);
  const gateway = await db.query("INSERT INTO fmcc_billing_gateway_account (tenant_id,provider,environment,label,secret_ref,status) VALUES ($1,'asaas','sandbox',$2,'env://FMCC_ASAAS_SANDBOX_API_KEY','enabled') RETURNING id",[tenant,"ci-"+id]);
  const sub = await db.query("INSERT INTO fmcc_billing_subscription (tenant_id,product_id,customer_id,plan_code) VALUES ($1,$2,$3,'kordena-ci-1990') RETURNING id",[tenant,product.rows[0].id,customer.rows[0].id]);
  await db.query("INSERT INTO fmcc_billing_invoice (id,tenant_id,product_id,customer_id,subscription_id,gateway_account_id,currency,amount_minor,status) VALUES ($1,$2,$3,$4,$5,$6,'BRL',1990,'pending')",[invoiceId,tenant,product.rows[0].id,customer.rows[0].id,sub.rows[0].id,gateway.rows[0].id]);
  await preflightProviderInvoice(request, invoiceId);
  const sandboxCustomer = await request("POST","/customers",{
    name:"FM Command Cliente Ficticio de Homologacao",email:"billing-test-"+id+"@example.com",
    cpfCnpj:"52998224725",externalReference:"fmcc-ci-"+id,notificationDisabled:true,
  });
  if (typeof sandboxCustomer.id !== "string" || !sandboxCustomer.id.startsWith("cus_")) throw new Error("billing.sandbox_customer_response_invalid");
  const claim=await db.query("UPDATE fmcc_billing_invoice SET status='creating' WHERE id=$1 AND tenant_id=$2 AND status='pending' RETURNING id",[invoiceId,tenant]);
  assert.equal(claim.rowCount,1);
  // Never retry POST /payments on a network timeout: the provider outcome may be uncertain.
  const due = new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  const charge = await request("POST","/payments",{customer:sandboxCustomer.id,billingType:"PIX",value:19.9,dueDate:due,description:"Kordena FMCC homologacao sem valor real",externalReference:invoiceId});
  paymentId=charge.id;
  if(typeof paymentId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId)) throw new Error("billing.sandbox_payment_response_invalid");
  validateCharge(charge);
  await db.query("INSERT INTO fmcc_billing_provider_payment (tenant_id,invoice_id,gateway_account_id,external_payment_id,status) VALUES ($1,$2,$3,$4,$5)",[tenant,invoiceId,gateway.rows[0].id,paymentId,charge.status]);
  const pending = await request("GET","/payments/"+paymentId);
  validateCharge(pending);
  const confirmed = await request("POST","/sandbox/payment/"+paymentId+"/confirm");
  validateCharge(confirmed);
  const verified = await request("GET","/payments/"+paymentId);
  validateCharge(verified);
  if(!["CONFIRMED","RECEIVED"].includes(verified.status))throw new Error("billing.sandbox_confirmation_not_final");
  await db.query("BEGIN");
  try {
    const binding=await db.query("SELECT i.id,i.tenant_id,i.product_id,i.customer_id,i.subscription_id,i.gateway_account_id,i.amount_minor,p.external_payment_id FROM fmcc_billing_invoice i JOIN fmcc_billing_provider_payment p ON p.tenant_id=i.tenant_id AND p.invoice_id=i.id AND p.gateway_account_id=i.gateway_account_id WHERE i.id=$1 AND i.tenant_id=$2 AND p.external_payment_id=$3 FOR UPDATE OF i,p",[invoiceId,tenant,paymentId]);
    assert.equal(binding.rowCount,1,"Canonical payment binding not found");
    assert.equal(Number(binding.rows[0].amount_minor),amountMinor);
    assert.equal(binding.rows[0].product_id,product.rows[0].id);
    assert.equal(binding.rows[0].customer_id,customer.rows[0].id);
    assert.equal(binding.rows[0].subscription_id,sub.rows[0].id);
    await db.query("UPDATE fmcc_billing_provider_payment SET status='received' WHERE tenant_id=$1 AND invoice_id=$2 AND external_payment_id=$3",[tenant,invoiceId,paymentId]);
    await db.query("UPDATE fmcc_billing_invoice SET status='paid' WHERE tenant_id=$1 AND id=$2",[tenant,invoiceId]);
    await db.query("COMMIT");
  }catch(e){await db.query("ROLLBACK");throw e;}
  const crossTenant=await db.query("SELECT count(*)::int AS n FROM fmcc_billing_invoice WHERE id=$1 AND tenant_id='different-tenant'",[invoiceId]);
  assert.equal(crossTenant.rows[0].n,0);
  const final=await db.query("SELECT status FROM fmcc_billing_invoice WHERE id=$1 AND tenant_id=$2",[invoiceId,tenant]);
  assert.equal(final.rows[0].status,"paid");
  console.log(JSON.stringify({result:"SANDBOX_PIX_CONFIRMED_AND_RECONCILED",amountBRL:"19.90",product:"Kordena",tenant,invoiceId,paymentId,providerStatus:verified.status,dbStatus:"paid",crossTenantIsolation:"PASS"}));
} catch(err) {
  console.error("SANDBOX_PIX_HOMOLOGATION_FAILED",err instanceof Error ? err.message : "unknown");
  if(paymentId) console.error("PROVIDER_PAYMENT_FOR_MANUAL_RECONCILIATION",paymentId);
  throw err;
} finally {await db.end();}
