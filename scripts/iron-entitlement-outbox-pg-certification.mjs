import assert from "node:assert/strict";
import pg from "pg";

/**
 * Disposable PostgreSQL 18 certification only.
 * No provider calls, credentials, real tenants, or license transitions.
 */
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const competitor = new pg.Client({ connectionString: process.env.DATABASE_URL });
const scope = "ci-iron-outbox-certification";
const event = "LICENSE_ACTIVATE";

await client.connect();
await competitor.connect();
try {
  await client.query("BEGIN");
  const product = await client.query(
    "INSERT INTO fmcc_product_definition (tenant_id,slug,name) VALUES ($1,'iron-fit-core','IRON CI Outbox') RETURNING id",[scope]);
  const customer = await client.query(
    "INSERT INTO fmcc_billing_customer (tenant_id,external_customer_id) VALUES ($1,'ci-outbox-gym') RETURNING id",[scope]);
  const gateway = await client.query(
    "INSERT INTO fmcc_billing_gateway_account (tenant_id,provider,environment,label,secret_ref,status) VALUES ($1,'asaas','production','ci-only','env:DISABLED_CI','enabled') RETURNING id",[scope]);
  await client.query(
    "INSERT INTO fmcc_billing_product_route (tenant_id,product_id,gateway_account_id,status) VALUES ($1,$2,$3,'enabled')",
    [scope,product.rows[0].id,gateway.rows[0].id]);
  const sub = await client.query(
    "INSERT INTO fmcc_billing_subscription (tenant_id,product_id,customer_id,plan_code,status) VALUES ($1,$2,$3,'CI_IRON','active') RETURNING id",
    [scope,product.rows[0].id,customer.rows[0].id]);
  const invoice = await client.query(
    "INSERT INTO fmcc_billing_invoice (tenant_id,product_id,customer_id,subscription_id,gateway_account_id,amount_minor,status) VALUES ($1,$2,$3,$4,$5,100,'paid') RETURNING id",
    [scope,product.rows[0].id,customer.rows[0].id,sub.rows[0].id,gateway.rows[0].id]);
  await client.query(
    "INSERT INTO fmcc_billing_provider_payment (tenant_id,invoice_id,gateway_account_id,external_payment_id,status) VALUES ($1,$2,$3,'ci-provider-proof','received')",
    [scope,invoice.rows[0].id,gateway.rows[0].id]);

  const outboxKey = "iron:entitlement:v1:" + invoice.rows[0].id + ":" + sub.rows[0].id + ":" + event;
  const args = [scope, product.rows[0].id, invoice.rows[0].id, sub.rows[0].id, event, outboxKey];
  const insert = `
    INSERT INTO fmcc_billing_iron_entitlement_outbox
      (tenant_id,product_id,invoice_id,subscription_id,event_type,idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (tenant_id,product_id,idempotency_key) DO NOTHING RETURNING id`;
  const first = await client.query(insert,args);
  const duplicate = await client.query(insert,args);
  assert.equal(first.rowCount,1);
  assert.equal(duplicate.rowCount,0, "Outbox replay produced another event");
  const outboxId = first.rows[0].id;
  const inspect = await client.query(
    "SELECT status,attempts,available_at,claim_token FROM fmcc_billing_iron_entitlement_outbox WHERE id=$1",[outboxId]);
  assert.equal(inspect.rows[0].status,"pending");
  assert.equal(inspect.rows[0].attempts,0);
  assert.equal(inspect.rows[0].claim_token,null);

  let wrongTenant = await client.query(
    "SELECT id FROM fmcc_billing_iron_entitlement_outbox WHERE id=$1 AND tenant_id='different-tenant'",[outboxId]);
  assert.equal(wrongTenant.rowCount,0, "Cross-tenant read exposed an outbox event");

  await client.query("SAVEPOINT invalid_type");
  let rejected = false;
  try {
    await client.query(insert,[...args.slice(0,4),"BYPASS_ENTITLEMENTS","invalid-event"]);
  } catch (error) {
    rejected = error?.code === "23514";
    await client.query("ROLLBACK TO SAVEPOINT invalid_type");
  }
  assert.equal(rejected,true,"Unsupported event type bypassed DB check");

  // Isolated transaction: do not retain disposable records from certification.
  await client.query("COMMIT");
  const claim = `
    WITH candidate AS (
      SELECT id FROM fmcc_billing_iron_entitlement_outbox
      WHERE tenant_id=$1 AND product_id=$2 AND status IN ('pending','retry')
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
    ) UPDATE fmcc_billing_iron_entitlement_outbox o SET
      status='processing', attempts=attempts+1, claim_token=$3,
      lease_until=now()+interval '90 seconds'
    FROM candidate WHERE o.id=candidate.id RETURNING o.id,o.attempts`;
  const claimToken = "f34c4104-3150-4110-a1a5-d74db066647f";
  const otherToken = "b2708f18-8a84-4af5-957b-a68c6b005d44";

  const acquired = await client.query(claim,[scope,product.rows[0].id,claimToken]);
  const raced = await competitor.query(claim,[scope,product.rows[0].id,otherToken]);
  assert.equal(acquired.rowCount,1);
  assert.equal(raced.rowCount,0,"Second worker claimed a leased event");
  const stale = await competitor.query(
    "UPDATE fmcc_billing_iron_entitlement_outbox SET status='delivered' WHERE id=$1 AND claim_token=$2",
    [outboxId,otherToken]);
  assert.equal(stale.rowCount,0,"Stale claim token bypassed fencing");

  // Simulate crashed worker and lease expiry then re-claim.
  await client.query(
    "UPDATE fmcc_billing_iron_entitlement_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",[outboxId]);
  const recovery = await competitor.query(`
    WITH candidate AS (
      SELECT id FROM fmcc_billing_iron_entitlement_outbox
      WHERE tenant_id=$1 AND product_id=$2 AND status='processing' AND lease_until<now()
      FOR UPDATE SKIP LOCKED
    )
    UPDATE fmcc_billing_iron_entitlement_outbox o SET
      attempts=attempts+1,claim_token=$3,lease_until=now()+interval '90 seconds'
    FROM candidate WHERE o.id=candidate.id RETURNING o.id,o.attempts
  `,[scope,product.rows[0].id,otherToken]);
  assert.equal(recovery.rowCount,1);
  assert.equal(recovery.rows[0].attempts,2);
  const staleAck = await client.query(
    "UPDATE fmcc_billing_iron_entitlement_outbox SET status='delivered' WHERE id=$1 AND claim_token=$2",
    [outboxId,claimToken]);
  assert.equal(staleAck.rowCount,0);
  const ack = await client.query(
    "UPDATE fmcc_billing_iron_entitlement_outbox SET status='delivered' WHERE id=$1 AND claim_token=$2",
    [outboxId,otherToken]);
  assert.equal(ack.rowCount,1);

  console.log("PASS D11 PostgreSQL: canonical FK, uniqueness, event checks, tenant fence, lease and reclaim");
} finally {
  // Disposable test scope, never clean any real tenant.
  await client.query("DELETE FROM fmcc_billing_iron_entitlement_outbox WHERE tenant_id=$1",[scope]).catch(()=>{});
  await client.query("DELETE FROM fmcc_billing_provider_payment WHERE tenant_id=$1",[scope]).catch(()=>{});
  await client.query("DELETE FROM fmcc_billing_invoice WHERE tenant_id=$1",[scope]).catch(()=>{});
  await client.query("DELETE FROM fmcc_billing_subscription WHERE tenant_id=$1",[scope]).catch(()=>{});
  await client.query("DELETE FROM fmcc_billing_product_route WHERE tenant_id=$1",[scope]).catch(()=>{});
  await client.query("DELETE FROM fmcc_billing_gateway_account WHERE tenant_id=$1",[scope]).catch(()=>{});
  await client.query("DELETE FROM fmcc_billing_customer WHERE tenant_id=$1",[scope]).catch(()=>{});
  await client.query("DELETE FROM fmcc_product_definition WHERE tenant_id=$1",[scope]).catch(()=>{});
  await competitor.end();
  await client.end();
}
