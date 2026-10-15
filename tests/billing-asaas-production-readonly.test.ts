import {describe,it,expect,vi} from "vitest";
import {AsaasProductionReadOnlyClient} from "../src/infrastructure/billing/asaas-production-readonly-client";
import {ASAAS_PRODUCTION_SECRET_REF,resolveGatewaySecret} from "../src/infrastructure/billing/secret-resolver";

describe("Production Asaas boundaries",()=>{
 it("rejects production secret in sandbox scope",()=>{
  expect(()=>resolveGatewaySecret({provider:"asaas",environment:"sandbox",secretRef:ASAAS_PRODUCTION_SECRET_REF},{FMCC_ASAAS_PRODUCTION_API_KEY:"fixture"})).toThrow("billing.secret_scope_denied");
 });
 it("only performs GET against production endpoint",async()=>{
  const old=process.env.FMCC_ASAAS_PRODUCTION_API_KEY;
  process.env.FMCC_ASAAS_PRODUCTION_API_KEY="fixture";
  try{
   const mock=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:"test"})});
   await new AsaasProductionReadOnlyClient(mock).verifyAccount();
   expect(mock).toHaveBeenCalledTimes(1);
   expect(mock.mock.calls[0][0]).toBe("https://api.asaas.com/v3/myAccount");
   expect(mock.mock.calls[0][1].method).toBe("GET");
   expect(mock.mock.calls[0][1].body).toBeUndefined();
  }finally{if(old===undefined)delete process.env.FMCC_ASAAS_PRODUCTION_API_KEY;else process.env.FMCC_ASAAS_PRODUCTION_API_KEY=old;}
 });
 it("rejects production API authentication failure",async()=>{
  const old=process.env.FMCC_ASAAS_PRODUCTION_API_KEY;
  process.env.FMCC_ASAAS_PRODUCTION_API_KEY="fixture";
  try{await expect(new AsaasProductionReadOnlyClient(vi.fn().mockResolvedValue({ok:false,status:401})).verifyAccount()).rejects.toThrow("billing.asaas_production_http_401");}
  finally{if(old===undefined)delete process.env.FMCC_ASAAS_PRODUCTION_API_KEY;else process.env.FMCC_ASAAS_PRODUCTION_API_KEY=old;}
 });
});
