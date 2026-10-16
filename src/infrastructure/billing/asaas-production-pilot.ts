import { assertNoPreviousPayment } from "../../../scripts/billing-provider-duplicate-guard.mjs";
import { ASAAS_PRODUCTION_SECRET_REF, resolveGatewaySecret } from "./secret-resolver";
import type { ProductionPilotLedger } from "./production-pilot-ledger";
import { logEvent } from "@/infrastructure/observability/logger";

export const PRODUCTION_PILOT_REFERENCE = "fmcc-kordena-real-pix-001-20261008";
export type ProductionPilotOutcome = "internal" | "deterministic_rejection" | "uncertain";
export class ProductionPilotError extends Error {
 constructor(
  message:string,
  readonly outcome:ProductionPilotOutcome="internal",
  readonly httpStatus?:number,
  readonly providerCode?:string,
 ) { super(message); this.name="ProductionPilotError"; }
}
export class AsaasProductionPilot {
 constructor(private readonly ledger: Pick<ProductionPilotLedger,"reserve"|"releaseAfterProviderRejection"|"persistProviderPayment"|"markProviderConfirmed"|"recoverProviderPayment">, private readonly transport: typeof fetch = fetch) {}
 private async request(method: "GET" | "POST", endpoint: string, payload?: object): Promise<{
   id:string; externalReference:string; billingType:string; value:number;
   status:string; invoiceUrl?:string; hasMore?:boolean;
   data?:Array<{id:string;externalReference:string;billingType:string;value:number}>;
  }> {
  const key = resolveGatewaySecret({provider:"asaas",environment:"production",secretRef:ASAAS_PRODUCTION_SECRET_REF});
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),15000);
  try {
   const response = await this.transport("https://api.asaas.com/v3"+endpoint,{
    method, headers:{access_token:key,accept:"application/json","content-type":"application/json","user-agent":"FMCommand-Pilot/1.0"},
    ...(payload?{body:JSON.stringify(payload)}:{}),signal:controller.signal,redirect:"error",cache:"no-store"
   });
   if(!response.ok){
    let providerCode:string|undefined;
    try {
     const body = typeof response.json==="function" ? await response.json() as unknown : null;
     if(body && typeof body==="object" && !Array.isArray(body)){
      const record=body as Record<string,unknown>;
      if(typeof record.code==="string")providerCode=record.code;
      else if(Array.isArray(record.errors)){
       const first=record.errors[0];
       if(first && typeof first==="object" && typeof (first as Record<string,unknown>).code==="string")
        providerCode=(first as Record<string,unknown>).code as string;
      }
     }
    } catch { /* response body is optional diagnostic data */ }
    const deterministic=response.status>=400&&response.status<500;
    logEvent(deterministic?"warn":"error","billing_provider_http_rejected",{
     provider:"asaas",method,endpoint,httpStatus:response.status,
     providerCode:providerCode??null,reference:PRODUCTION_PILOT_REFERENCE,
     outcome:deterministic?"deterministic_rejection":"uncertain",
    });
    throw new ProductionPilotError(
     "billing.production_http_"+response.status,
     deterministic?"deterministic_rejection":"uncertain",
     response.status,providerCode,
    );
   }
   return response.json();
  }catch(error){
   if(error instanceof ProductionPilotError)throw error;
   logEvent("error","billing_provider_transport_uncertain",{
    provider:"asaas",method,endpoint,reference:PRODUCTION_PILOT_REFERENCE,
    errorCode:error instanceof Error?error.name:"unknown",
   });
   throw new ProductionPilotError("billing.production_transport_uncertain","uncertain");
  }finally{clearTimeout(timer);}
 }
 async findPilotPaymentsForRecovery():Promise<Array<{id:string}>> {
  const data = await this.request("GET","/payments?externalReference="+encodeURIComponent(PRODUCTION_PILOT_REFERENCE));
  if (!data || !Array.isArray(data.data) || data.hasMore === true)
   throw new ProductionPilotError("billing.production_recovery_incomplete_provider_listing");
  const entries = data.data.filter((payment:unknown): payment is Record<string,unknown> =>
   !!payment && typeof payment === "object" &&
   (payment as Record<string,unknown>).externalReference === PRODUCTION_PILOT_REFERENCE);
  if(entries.some((payment:Record<string,unknown>) => typeof payment.id!=="string" ||
     !/^[A-Za-z0-9_-]{1,128}$/.test(payment.id) ||
     payment.billingType!=="PIX" ||
     typeof payment.value!=="number" || Math.round(payment.value*100)!==100))
   throw new ProductionPilotError("billing.production_recovery_provider_mismatch");
  return entries.map((payment:Record<string,unknown>)=>({id:payment.id as string}));
 }
 async recoverUncertainRealPix(input:{tenantId:string;invoiceId:string;gatewayAccountId:string;externalPaymentId:string}):Promise<"recovered"|"already_recorded">{
  if(input.invoiceId!=="a51a5000-1990-4000-8000-000000000001" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.externalPaymentId))
   throw new ProductionPilotError("billing.production_recovery_binding_invalid");
  const payment=await this.request("GET","/payments/"+input.externalPaymentId);
  if(!payment || payment.id!==input.externalPaymentId || payment.externalReference!==PRODUCTION_PILOT_REFERENCE ||
     payment.billingType!=="PIX" || !Number.isFinite(payment.value) || Math.round(payment.value*100)!==100)
   throw new ProductionPilotError("billing.production_recovery_mismatch");
  return this.ledger.recoverProviderPayment({...input,status:payment.status});
 }
 async reconcileRealPix(input:{tenantId:string;invoiceId:string;gatewayAccountId:string;externalPaymentId:string}):Promise<"paid"|"pending">{
  if(input.invoiceId!=="a51a5000-1990-4000-8000-000000000001" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.externalPaymentId))
   throw new ProductionPilotError("billing.production_reconciliation_binding_invalid");
  const payment=await this.request("GET","/payments/"+input.externalPaymentId);
  if(!payment || payment.id!==input.externalPaymentId || payment.externalReference!==PRODUCTION_PILOT_REFERENCE ||
     payment.billingType!=="PIX" || !Number.isFinite(payment.value) || Math.round(payment.value*100)!==100)
   throw new ProductionPilotError("billing.production_reconciliation_mismatch");
  if(!["RECEIVED","CONFIRMED"].includes(payment.status))return "pending";
  await this.ledger.markProviderConfirmed(input);
  return "paid";
 }
 async checkReference():Promise<void> {
  const data = await this.request("GET","/payments?externalReference="+encodeURIComponent(PRODUCTION_PILOT_REFERENCE));
  assertNoPreviousPayment(data);
 }
 async createOneRealPix(input:{customerId:string; dueDate:string; authorization:string; tenantId:string; invoiceId:string; gatewayAccountId:string}):Promise<{id:string;invoiceUrl?:string}>{
  if(input.authorization!=="AUTHORIZE_REAL_PIX_BRL_1_00")throw new ProductionPilotError("billing.production_authorization_missing");
  if(!/^cus_[A-Za-z0-9_-]+$/.test(input.customerId))throw new ProductionPilotError("billing.production_customer_id_invalid");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate))throw new ProductionPilotError("billing.production_date_invalid");
  if (input.invoiceId!=="a51a5000-1990-4000-8000-000000000001" || !input.tenantId || !input.gatewayAccountId) throw new ProductionPilotError("billing.production_binding_missing");
  // Both provider preflight and persistent claim must succeed before a real POST.
  logEvent("info","billing_pilot_provider_preflight_started",{invoiceId:input.invoiceId,reference:PRODUCTION_PILOT_REFERENCE});
  await this.checkReference();
  logEvent("info","billing_pilot_provider_preflight_succeeded",{invoiceId:input.invoiceId,reference:PRODUCTION_PILOT_REFERENCE});
  if (!await this.ledger.reserve(input)) throw new ProductionPilotError("billing.production_invoice_claim_denied");
  logEvent("info","billing_pilot_invoice_reserved",{invoiceId:input.invoiceId,reference:PRODUCTION_PILOT_REFERENCE});
  let result;
  try {
   logEvent("info","billing_pilot_provider_post_started",{invoiceId:input.invoiceId,reference:PRODUCTION_PILOT_REFERENCE});
   result = await this.request("POST","/payments",{
    customer:input.customerId,billingType:"PIX",value:1,dueDate:input.dueDate,
    description:"FM Command Kordena - teste real autorizado R$ 1,00",externalReference:PRODUCTION_PILOT_REFERENCE
   });
   logEvent("info","billing_pilot_provider_post_succeeded",{invoiceId:input.invoiceId,reference:PRODUCTION_PILOT_REFERENCE});
  } catch(error){
   if(error instanceof ProductionPilotError && error.outcome==="deterministic_rejection"){
    const released=await this.ledger.releaseAfterProviderRejection(input);
    logEvent(released?"warn":"error","billing_pilot_provider_rejection_released",{
     invoiceId:input.invoiceId,reference:PRODUCTION_PILOT_REFERENCE,
     released,httpStatus:error.httpStatus??null,providerCode:error.providerCode??null,
    });
   } else {
    logEvent("error","billing_pilot_provider_post_uncertain",{
     invoiceId:input.invoiceId,reference:PRODUCTION_PILOT_REFERENCE,
     errorCode:error instanceof Error?error.message:"unknown",
    });
   }
   throw error;
  }
  if(!result || typeof result.id!=="string" || result.externalReference!==PRODUCTION_PILOT_REFERENCE ||
     Math.round(Number(result.value)*100)!==100 || result.billingType!=="PIX")
   throw new ProductionPilotError("billing.production_payment_response_mismatch","uncertain");
  await this.ledger.persistProviderPayment({tenantId:input.tenantId,invoiceId:input.invoiceId,gatewayAccountId:input.gatewayAccountId,externalPaymentId:result.id,status:result.status || "pending"});
  logEvent("info","billing_pilot_provider_payment_persisted",{invoiceId:input.invoiceId,reference:PRODUCTION_PILOT_REFERENCE});
  return {id:result.id,invoiceUrl:typeof result.invoiceUrl==="string"?result.invoiceUrl:undefined};
 }
}
