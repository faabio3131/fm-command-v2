import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { StepUpRequiredError, verifyPasswordStepUp } from "@/application/security/password-step-up";
import { requirePermission } from "@/domain/security/tenant-context";
import { db, pool } from "@/infrastructure/db/client";
import { billingInvoices, billingGatewayAccounts, billingProviderPayments } from "@/infrastructure/db/billing-schema";
import { AsaasProductionPilot, PRODUCTION_PILOT_REFERENCE, ProductionPilotError } from "@/infrastructure/billing/asaas-production-pilot";
import { ProductionPilotLedger } from "@/infrastructure/billing/production-pilot-ledger";
import { GatewaySecretError } from "@/infrastructure/billing/secret-resolver";
import { logEvent } from "@/infrastructure/observability/logger";

export const dynamic = "force-dynamic";
const INVOICE = "a51a5000-1990-4000-8000-000000000001";

/**
 * Explicit operator recovery for ambiguous provider POST. Provider lookups are
 * READ ONLY; never create payments on recovery. Fail closed on zero or >1.
 * Requires active owner/admin + password reauthentication.
 */
export async function POST(request: Request) {
 if (process.env.FMCC_PILOT_PIX_ISSUANCE_ENABLED !== "YES")
  return NextResponse.json({error:"billing.recovery_disabled"}, {status:503});
 try {
  const h = await headers();
  const ctx = await resolveTenantContext(h);
  requirePermission(ctx, "billing:write");
  if (ctx.role !== "owner" && ctx.role !== "admin")
   return NextResponse.json({error:"billing.admin_required"},{status:403});

  const body:unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof (body as {password?:unknown}).password !== "string")
   return NextResponse.json({error:"billing.invalid_request"},{status:400});

  const proof = await verifyPasswordStepUp(h,(body as {password:string}).password);
  if(proof.userId !== ctx.userId)
   return NextResponse.json({error:"billing.step_up_required"},{status:403});

  logEvent("info","billing_pilot_recovery_started",{
   invoiceId:INVOICE,tenantId:ctx.tenantId,correlationId:ctx.correlationId,
  });

  const [row] = await db.select({
   invoiceId:billingInvoices.id, gatewayId:billingInvoices.gatewayAccountId,
   status:billingInvoices.status,amount:billingInvoices.amountMinor,
   currency:billingInvoices.currency,provider:billingGatewayAccounts.provider,
   environment:billingGatewayAccounts.environment,
  }).from(billingInvoices).innerJoin(billingGatewayAccounts,and(
   eq(billingGatewayAccounts.id,billingInvoices.gatewayAccountId),
   eq(billingGatewayAccounts.tenantId,billingInvoices.tenantId),
  )).where(and(eq(billingInvoices.tenantId,ctx.tenantId),eq(billingInvoices.id,INVOICE))).limit(1);

  if(!row||row.amount!==100||row.currency!=="BRL"||row.provider!=="asaas"||
     row.environment!=="production"||!["creating","payment_pending","paid"].includes(row.status))
   return NextResponse.json({error:"billing.recovery_scope_invalid"},{status:409});

  const previous = await db.select({id:billingProviderPayments.externalPaymentId})
   .from(billingProviderPayments).where(and(
    eq(billingProviderPayments.tenantId,ctx.tenantId),
    eq(billingProviderPayments.invoiceId,INVOICE),
    eq(billingProviderPayments.gatewayAccountId,row.gatewayId),
   )).limit(1);

  if(previous.length) {
   logEvent("info","billing_pilot_recovery_already_recorded",{invoiceId:INVOICE});
   return NextResponse.json({status:"already_recorded",paymentId:previous[0].id},
    {headers:{"Cache-Control":"no-store"}});
  }

  if(row.status!=="creating")
   return NextResponse.json({error:"billing.no_pending_provider_claim"},{status:409});

  const pilot = new AsaasProductionPilot(new ProductionPilotLedger(pool));
  const candidates = await pilot.findPilotPaymentsForRecovery();

  if(candidates.length===0) {
   const released=await new ProductionPilotLedger(pool).releaseAfterVerifiedProviderAbsence({
    tenantId:ctx.tenantId,invoiceId:INVOICE,gatewayAccountId:row.gatewayId,
   });
   logEvent(released?"warn":"error","billing_pilot_recovery_zero_provider_release",{
    invoiceId:INVOICE,count:0,released,
   });
   if(!released)
    return NextResponse.json({error:"billing.recovery_release_conflict"},{status:409});
   return NextResponse.json({
    status:"released_no_provider_payment",
    paymentId:null,
    reference:PRODUCTION_PILOT_REFERENCE,
   },{headers:{"Cache-Control":"no-store"}});
  }

  if(candidates.length>1) {
   logEvent("error","billing_pilot_recovery_candidate_count",{
    invoiceId:INVOICE,count:candidates.length,error:"billing.provider_duplicates_manual_review",
   });
   return NextResponse.json({error:"billing.provider_duplicates_manual_review"},{status:409});
  }

  const candidate=candidates[0];
  const result=await pilot.recoverUncertainRealPix({
   tenantId:ctx.tenantId,invoiceId:INVOICE,gatewayAccountId:row.gatewayId,
   externalPaymentId:candidate.id,
  });
  logEvent("info","billing_pilot_recovery_succeeded",{
   invoiceId:INVOICE,status:result,paymentId:candidate.id,
  });
  return NextResponse.json({status:result,paymentId:candidate.id,reference:PRODUCTION_PILOT_REFERENCE},
   {headers:{"Cache-Control":"no-store"}});
 } catch(error) {
  if(error instanceof StepUpRequiredError) {
   logEvent("warn","billing_pilot_recovery_failed",{invoiceId:INVOICE,errorCode:"billing.step_up_required"});
   return NextResponse.json({error:"billing.step_up_required"},{status:403});
  }
  if(error instanceof GatewaySecretError) {
   logEvent("error","billing_pilot_recovery_failed",{invoiceId:INVOICE,errorCode:error.code});
   return NextResponse.json({error:error.code},{status:503});
  }
  if(error instanceof ProductionPilotError) {
   const publicCode =
    error.httpStatus===401?"billing.asaas_authentication_failed":
    error.httpStatus===403?"billing.asaas_access_forbidden":
    error.outcome==="uncertain"?"billing.asaas_connection_uncertain":
    "billing.recovery_provider_failed";
   logEvent("error","billing_pilot_recovery_failed",{
    invoiceId:INVOICE,errorCode:publicCode,httpStatus:error.httpStatus??null,
    providerCode:error.providerCode??null,outcome:error.outcome,
   });
   return NextResponse.json({
    error:publicCode,
    providerStatus:error.httpStatus??null,
    providerCode:error.providerCode??null,
   },{status:error.httpStatus===401||error.httpStatus===403?502:409});
  }
  logEvent("error","billing_pilot_recovery_failed",{
   invoiceId:INVOICE,errorCode:error instanceof Error?error.name:"unknown",
  });
  return NextResponse.json({error:"billing.recovery_failed_manual_review"},{status:409});
 }
}
