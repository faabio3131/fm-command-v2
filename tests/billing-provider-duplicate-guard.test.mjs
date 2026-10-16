import test from "node:test";
import assert from "node:assert/strict";
import { assertNoPreviousPayment } from "../scripts/billing-provider-duplicate-guard.mjs";
test("allows a confirmed empty provider response",()=>assert.doesNotThrow(()=>assertNoPreviousPayment({data:[],totalCount:0})));
test("blocks provider payment already registered",()=>assert.throws(()=>assertNoPreviousPayment({data:[{id:"pay_1"}],totalCount:1}),/already_present/));
test("blocks nonempty count even if truncated data",()=>assert.throws(()=>assertNoPreviousPayment({data:[],totalCount:1}),/already_present/));
test("fails closed on unknown response",()=>assert.throws(()=>assertNoPreviousPayment({data:[]}),/unavailable/));
test("fails closed on null response",()=>assert.throws(()=>assertNoPreviousPayment(null),/unavailable/));
