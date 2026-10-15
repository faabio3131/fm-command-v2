import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { verifyPasswordStepUp } from "@/application/security/password-step-up";
import { requirePermission } from "@/domain/security/tenant-context";
import { environmentIronControlTenantId } from "@/infrastructure/integration/iron-commercial-connector";
import { pool } from "@/infrastructure/db/client";
import { PostgresIronAsaasIssuer } from "@/infrastructure/billing/postgres-iron-asaas-issuer";
import { AsaasIronIssuerClient } from "@/infrastructure/billing/asaas-iron-issuer-client";
import { AsaasCheckoutClient } from "@/infrastructure/billing/asaas-checkout-client";
import { GovernedIronAsaasIssuance } from "@/infrastructure/billing/governed-iron-asaas-issuance";

export const dynamic = "force-dynamic";

/**
 * This is the actual Asaas production POST capability, but it is
 * deliberately OFF by default. It does not trigger automated billing.
 * The admin supplies a due date; the existing Asaas payer is resolved from
 * the canonical academy reference (an explicit ID is optional and verified);
 * product, invoice, academy, plan and amount always come from FM Command.
 */
export async function POST(request:Request,{
  params,
}: {params:Promise<{productId:string}>}) {
  if (process.env.FMCC_IRON_ASAAS_ISSUANCE_ENABLED !== "YES") {
    return NextResponse.json({error:"billing.iron_issuer_disabled"},{status:503});
  }
  try {
    const requestHeaders=await headers();
    const ctx=await resolveTenantContext(requestHeaders);
    requirePermission(ctx,"billing:write");
    if ((ctx.role!=="owner" && ctx.role!=="admin") ||
        !environmentIronControlTenantId() ||
        ctx.tenantId!==environmentIronControlTenantId()) {
      return NextResponse.json({error:"billing.iron_issuer_scope_denied"},{status:403});
    }
    const body:unknown=await request.json();
    if(!body||typeof body!=="object"||Array.isArray(body)){
      return NextResponse.json({error:"billing.iron_issuer_invalid_request"},{status:400});
    }
    const input=body as Record<string,unknown>;
    if (typeof input.password!=="string"||typeof input.invoiceId!=="string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.invoiceId) ||
        (input.action!=="issue" && input.action!=="recover")) {
      return NextResponse.json({error:"billing.iron_issuer_invalid_request"},{status:400});
    }
    const proof=await verifyPasswordStepUp(requestHeaders,input.password);
    if(proof.userId!==ctx.userId){
      return NextResponse.json({error:"security.step_up_required"},{status:403});
    }
    const {productId}=await params;
    const issuer=new GovernedIronAsaasIssuance(
      new PostgresIronAsaasIssuer(pool),new AsaasIronIssuerClient(),new AsaasCheckoutClient(),
    );
    let result;
    if(input.action==="issue"){
      if((input.customerId!==undefined && typeof input.customerId!=="string") ||
         typeof input.dueDate!=="string"){
        return NextResponse.json({error:"billing.iron_issuer_invalid_request"},{status:400});
      }
      result=await issuer.issue({
        tenantId:ctx.tenantId,productId,invoiceId:input.invoiceId,
        ...(input.customerId!==undefined ? {customerId:input.customerId} : {}),
        dueDate:input.dueDate,
      });
    }else{
      result=await issuer.recover({tenantId:ctx.tenantId,productId,invoiceId:input.invoiceId});
    }
    // Response contains a provider ID only when securely bound; no credentials or
    // personal legal documents appear in the response or application logs.
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch{
    return NextResponse.json({error:"billing.iron_issuer_denied_or_unverified"},{status:409});
  }
}
