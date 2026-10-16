import assert from "node:assert/strict";
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const version = await client.query("SHOW server_version");
  assert.match(version.rows[0].server_version, /^18\./);
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'fmcc_billing_%' ORDER BY tablename");
  assert.equal(tables.rowCount, 14, "Expected fourteen Billing tables including IRON payer enrollment");
  const migrations = await client.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
  assert.equal(migrations.rows[0].n, 12, "Expected migrations 0000-0011");
  const idx = await client.query("SELECT indexname FROM pg_indexes WHERE tablename='fmcc_billing_provider_payment' AND indexname='fmcc_billing_provider_invoice_uq'");
  assert.equal(idx.rowCount, 1, "Missing one-payment-per-invoice index");
  for (const [tableName,indexName] of [
    ["fmcc_billing_product_plan","fmcc_billing_plan_scope_code_uq"],
    ["fmcc_billing_customer_binding","fmcc_billing_customer_binding_external_uq"],
    ["fmcc_billing_product_route","fmcc_billing_product_route_product_uq"],
    ["fmcc_billing_command_request","fmcc_billing_command_idempotency_uq"],
    ["fmcc_billing_iron_entitlement_outbox","fmcc_iron_outbox_dedupe_uq"],
    ["fmcc_billing_iron_issue_claim","fmcc_iron_issue_invoice_uq"],
    ["fmcc_billing_iron_issue_claim","fmcc_iron_issue_reference_uq"],
    ["fmcc_billing_iron_customer_enrollment","fmcc_iron_payer_academy_uq"],
    ["fmcc_billing_iron_customer_enrollment","fmcc_iron_payer_provider_ref_uq"],
  ]) {
    const result = await client.query(
      "SELECT indexname FROM pg_indexes WHERE tablename=$1 AND indexname=$2",
      [tableName,indexName],
    );
    assert.equal(result.rowCount,1,"Missing central billing authority index "+indexName);
  }
  // Verify that a real PostgreSQL transaction rolls back on failure.
  await client.query("BEGIN");
  await client.query("INSERT INTO fmcc_billing_customer (tenant_id, external_customer_id) VALUES ($1,$2)", ["homologation", "ci-rollback-probe"]);
  await client.query("ROLLBACK");
  const rollback = await client.query("SELECT count(*)::int AS n FROM fmcc_billing_customer WHERE tenant_id=$1 AND external_customer_id=$2", ["homologation", "ci-rollback-probe"]);
  assert.equal(rollback.rows[0].n, 0, "Rollback did not remove test record");
  // A unique tenant/customer external identity must be enforced by the database.
  await client.query("BEGIN");
  await client.query("INSERT INTO fmcc_billing_customer (tenant_id, external_customer_id) VALUES ($1,$2)", ["homologation", "ci-duplicate-probe"]);
  let duplicateRejected = false;
  await client.query("SAVEPOINT duplicate_attempt");
  try {
    await client.query("INSERT INTO fmcc_billing_customer (tenant_id, external_customer_id) VALUES ($1,$2)", ["homologation", "ci-duplicate-probe"]);
  } catch (error) {
    duplicateRejected = error?.code === "23505";
    await client.query("ROLLBACK TO SAVEPOINT duplicate_attempt");
  }
  assert.equal(duplicateRejected, true, "Unique customer identity not enforced");
  await client.query("ROLLBACK");
  // Real competing connections: only one may claim an invoice.
  const product = await client.query("INSERT INTO fmcc_product_definition (tenant_id,slug,name) VALUES ('ci-tenant','ci-kordena','Kordena CI') RETURNING id");
  const customer = await client.query("INSERT INTO fmcc_billing_customer (tenant_id,external_customer_id) VALUES ('ci-tenant','ci-customer') RETURNING id");
  const account = await client.query("INSERT INTO fmcc_billing_gateway_account (tenant_id,provider,environment,label,secret_ref,status) VALUES ('ci-tenant','asaas','sandbox','ci','env://FMCC_ASAAS_SANDBOX_API_KEY','enabled') RETURNING id");
  const subscription = await client.query("INSERT INTO fmcc_billing_subscription (tenant_id,product_id,customer_id,plan_code) VALUES ('ci-tenant',$1,$2,'ci-plan') RETURNING id",[product.rows[0].id,customer.rows[0].id]);
  const invoice = await client.query("INSERT INTO fmcc_billing_invoice (tenant_id,product_id,customer_id,subscription_id,gateway_account_id,amount_minor) VALUES ('ci-tenant',$1,$2,$3,$4,1990) RETURNING id",[product.rows[0].id,customer.rows[0].id,subscription.rows[0].id,account.rows[0].id]);
  const competitor = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await competitor.connect();
  try {
    // Verify physical multi-connection serialization for a single SaaS tenant.
    // The repository acquires this exact transaction-scoped lock before checking
    // its idempotency ledger and existing live subscription.
    const lockScope = "fmcc.billing.subscription.v1:ci-tenant:" + product.rows[0].id + ":ci-gym";
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockScope]);
    await competitor.query("BEGIN");
    await competitor.query("SET LOCAL lock_timeout = '300ms'");
    let competingPreparationBlocked = false;
    try {
      await competitor.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockScope]);
    } catch (error) {
      competingPreparationBlocked = error?.code === "55P03";
    } finally {
      await competitor.query("ROLLBACK");
      await client.query("ROLLBACK");
    }
    assert.equal(competingPreparationBlocked, true, "Concurrent SaaS subscription preparation did not serialize");

    const claim = "UPDATE fmcc_billing_invoice SET status='creating' WHERE tenant_id=$1 AND id=$2 AND status='pending' RETURNING id";
    const attempts = await Promise.all([client.query(claim,['ci-tenant',invoice.rows[0].id]),competitor.query(claim,['ci-tenant',invoice.rows[0].id])]);
    assert.deepEqual(attempts.map(r=>r.rowCount).sort(),[0,1],"Concurrent invoice claim allowed duplicate creation");
    const provider = await client.query("INSERT INTO fmcc_billing_provider_payment (tenant_id,invoice_id,gateway_account_id,external_payment_id) VALUES ('ci-tenant',$1,$2,'pay-ci-one') RETURNING id",[invoice.rows[0].id,account.rows[0].id]);
    let providerDuplicate = false;
    try {
      await competitor.query("INSERT INTO fmcc_billing_provider_payment (tenant_id,invoice_id,gateway_account_id,external_payment_id) VALUES ('ci-tenant',$1,$2,'pay-ci-two')",[invoice.rows[0].id,account.rows[0].id]);
    } catch (error) { providerDuplicate = error?.code === '23505'; }
    assert.ok(provider.rows[0].id);
    assert.equal(providerDuplicate,true,"Second provider payment for same invoice was accepted");

    const issuedClaim=await client.query(
      "INSERT INTO fmcc_billing_iron_issue_claim (tenant_id,product_id,invoice_id,gateway_account_id,external_customer_id,external_reference) VALUES ('ci-tenant',$1,$2,$3,'cus_ci_issuer',$4) RETURNING id",
      [product.rows[0].id,invoice.rows[0].id,account.rows[0].id,'fmcc-iron-'+invoice.rows[0].id]);
    assert.equal(issuedClaim.rowCount,1,"One-shot issuance claim was not recorded");
    let duplicateClaimDenied=false;
    try {
      await competitor.query(
        "INSERT INTO fmcc_billing_iron_issue_claim (tenant_id,product_id,invoice_id,gateway_account_id,external_customer_id,external_reference) VALUES ('ci-tenant',$1,$2,$3,'cus_ci_other',$4)",
        [product.rows[0].id,invoice.rows[0].id,account.rows[0].id,'fmcc-iron-'+invoice.rows[0].id]);
    } catch(error) { duplicateClaimDenied=error?.code==='23505'; }
    assert.equal(duplicateClaimDenied,true,"Duplicate Asaas issuance claim was accepted");
    const webhook=await client.query(
      "INSERT INTO fmcc_billing_gateway_event (tenant_id,gateway_account_id,external_event_id,event_type,external_payment_id,external_reference,payload_fingerprint) VALUES ('ci-tenant',$1,'evt_ci_webhook','PAYMENT_RECEIVED','pay_ci_one',$2,$3) RETURNING id",
      [account.rows[0].id,'fmcc-iron-'+invoice.rows[0].id,'a'.repeat(64)]);
    assert.equal(webhook.rowCount,1,"Webhook inbox event not persisted");
    const webhookColumns=await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='fmcc_billing_gateway_event' AND column_name=ANY($1::text[])",
      [['event_type','external_payment_id','external_reference','payload_fingerprint']]);
    assert.equal(webhookColumns.rowCount,4,"Webhook metadata migration missing");
    const workerColumns=await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='fmcc_billing_gateway_event' AND column_name=ANY($1::text[])",
      [['attempts','available_at','lease_until','claim_token','last_error_code','processed_at','updated_at']]);
    assert.equal(workerColumns.rowCount,7,"Worker lease/fencing migration missing");
    let duplicateWebhookDenied=false;
    try {
      await competitor.query(
        "INSERT INTO fmcc_billing_gateway_event (tenant_id,gateway_account_id,external_event_id) VALUES ('ci-tenant',$1,'evt_ci_webhook')",
        [account.rows[0].id]);
    } catch(error) { duplicateWebhookDenied=error?.code==='23505'; }
    assert.equal(duplicateWebhookDenied,true,"Webhook event ID uniqueness not enforced");
    const academy=await client.query(
      "INSERT INTO fmcc_billing_iron_customer_enrollment (tenant_id,product_id,customer_id,external_tenant_id,gateway_account_id,external_reference) VALUES ('ci-tenant',$1,$2,$3,$4,$5) RETURNING id",
      [product.rows[0].id,customer.rows[0].id,'8042dfb0-80db-49de-86b1-011c27e7bb5d',account.rows[0].id,'fmcc-iron-customer-8042dfb0-80db-49de-86b1-011c27e7bb5d']);
    assert.equal(academy.rowCount,1,"Payer enrollment not persisted");
    let duplicatePayerDenied=false;
    try{
      await competitor.query(
        "INSERT INTO fmcc_billing_iron_customer_enrollment (tenant_id,product_id,customer_id,external_tenant_id,gateway_account_id,external_reference) VALUES ('ci-tenant',$1,$2,$3,$4,$5)",
        [product.rows[0].id,customer.rows[0].id,'8042dfb0-80db-49de-86b1-011c27e7bb5d',account.rows[0].id,'fmcc-iron-customer-8042dfb0-80db-49de-86b1-011c27e7bb5d']);
    }catch(error){duplicatePayerDenied=error?.code==='23505';}
    assert.equal(duplicatePayerDenied,true,"Duplicate academy payer reservation accepted");
    console.log("PASS PostgreSQL 18: competing invoice claims and payment uniqueness");
  } finally {
    await competitor.end();
    await client.query("DELETE FROM fmcc_billing_iron_customer_enrollment WHERE tenant_id='ci-tenant'");
    await client.query("DELETE FROM fmcc_billing_gateway_event WHERE tenant_id='ci-tenant'");
    await client.query("DELETE FROM fmcc_billing_iron_issue_claim WHERE tenant_id='ci-tenant'");
    await client.query("DELETE FROM fmcc_billing_provider_payment WHERE tenant_id='ci-tenant'");
    await client.query("DELETE FROM fmcc_billing_invoice WHERE tenant_id='ci-tenant'");
    await client.query("DELETE FROM fmcc_billing_subscription WHERE tenant_id='ci-tenant'");
    await client.query("DELETE FROM fmcc_billing_gateway_account WHERE tenant_id='ci-tenant'");
    await client.query("DELETE FROM fmcc_billing_customer WHERE tenant_id='ci-tenant'");
    await client.query("DELETE FROM fmcc_product_definition WHERE tenant_id='ci-tenant'");
  }
  console.log("PASS PostgreSQL 18: migrations 0000-0011, 14 billing tables, canonical payer enrollment, webhook inbox and worker lease, product-scoped authority, uniqueness and transactional rollback");
} finally {
  await client.end();
}
