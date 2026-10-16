import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxChargeAfterPreflight } from "../scripts/billing-provider-preflight.mjs";

const invoiceId="a51a5000-1990-4000-8000-000000000001";
const charge={customer:"cus_ci",billingType:"PIX",value:19.9,dueDate:"2026-10-20"};
test("existing provider invoice blocks POST /payments",async()=>{
 const calls=[];
 const request=async(m,p)=>{calls.push([m,p]); return {data:[{id:"pay_existing"}],totalCount:1};};
 await assert.rejects(createSandboxChargeAfterPreflight(request,invoiceId,charge),/already_present/);
 assert.deepEqual(calls.map(([m])=>m),["GET"]);
});
test("malformed provider response blocks POST /payments",async()=>{
 const calls=[];
 const request=async(m,p)=>{calls.push([m,p]);return {data:[]};};
 await assert.rejects(createSandboxChargeAfterPreflight(request,invoiceId,charge),/unavailable/);
 assert.equal(calls.length,1);
});
test("provider lookup network failure blocks POST /payments",async()=>{
 const calls=[];
 const request=async(m,p)=>{calls.push([m,p]);throw new Error("timeout");};
 await assert.rejects(createSandboxChargeAfterPreflight(request,invoiceId,charge),/timeout/);
 assert.equal(calls.length,1);
});
test("empty provider list permits exactly one POST, preserving invoice reference",async()=>{
 const calls=[];
 const request=async(m,p,b)=>{calls.push({m,p,b});return m==="GET"?{data:[],totalCount:0}:{id:"pay_created"};};
 const result=await createSandboxChargeAfterPreflight(request,invoiceId,charge);
 assert.equal(result.id,"pay_created");
 assert.deepEqual(calls.map(x=>x.m),["GET","POST"]);
 assert.equal(calls[1].b.externalReference,invoiceId);
});
