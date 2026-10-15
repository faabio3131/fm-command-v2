import test from "node:test";
import assert from "node:assert/strict";
import {assertPersistentDatabase,inspectPilotInvoice,PILOT_INVOICE_ID} from "../scripts/billing-production-pilot-readiness.mjs";
test("rejects disposable database",()=>assert.throws(()=>assertPersistentDatabase("postgresql://ci:pw@localhost:5432/fmcc_billing_ci"),/not_persistent/));
test("accepts external persistent PostgreSQL location",()=>assert.doesNotThrow(()=>assertPersistentDatabase("postgresql://ci:pw@db.internal.example:5432/fmcc_persistent")));
const row={id:PILOT_INVOICE_ID,status:"pending",tenant_id:"fmcc",amount_minor:"100",currency:"BRL",product_id:"prod",customer_id:"cust",subscription_id:"sub",gateway_account_id:"gateway",provider:"asaas",environment:"production",gateway_status:"enabled",secret_ref:"env://FMCC_ASAAS_PRODUCTION_API_KEY",payment_id:null,product_name:"Kordena"};
test("accepts valid persistent pilot invoice without charging",async()=>{
 const db={query:async(q,args)=>{assert.equal(args[0],PILOT_INVOICE_ID);return {rows:[row]};}};
 const x=await inspectPilotInvoice(db);
 assert.equal(x.amountMinor,100);
});
test("blocks invoice already claimed or paid",async()=>{
 await assert.rejects(inspectPilotInvoice({query:async()=>({rows:[{...row,status:"creating"}]})}),/not_ready/);
});
test("blocks cross-environment gateway",async()=>{
 await assert.rejects(inspectPilotInvoice({query:async()=>({rows:[{...row,environment:"sandbox"}]})}),/not_ready/);
});
test("blocks existing payment and missing invoice",async()=>{
 await assert.rejects(inspectPilotInvoice({query:async()=>({rows:[{...row,payment_id:"pay_existing"}]})}),/not_ready/);
 await assert.rejects(inspectPilotInvoice({query:async()=>({rows:[]})}),/not_provisioned/);
});
