import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { verifyPasswordStepUp } from "@/application/security/password-step-up";
import { requirePermission } from "@/domain/security/tenant-context";
import { environmentIronControlTenantId } from "@/infrastructure/integration/iron-commercial-connector";
import { pool } from "@/infrastructure/db/client";
import { PostgresIronPayerEnrollment } from "@/infrastructure/billing/postgres-iron-payer-enrollment";
import { AsaasCheckoutClient } from "@/infrastructure/billing/asaas-checkout-client";
import { GovernedIronPayerEnrollment } from "@/infrastructure/billing/governed-iron-payer-enrollment";

export const dynamic="force-dynamic";

/** FM Command -> gym SaaS billing ONLY. Never gym -> student financials. */
export async function POST(request:Request,{
  params,
}:{params:Promise<{productId:string}>}){
  if(process.env.FMCC_IRON_ASAAS_PAYER_ENROLLMENT_ENABLED!=="YES"){
    return NextResponse.json({error:"billing.iron_payer_enrollment_disabled"},{status:503});
  }
  try{
    const requestHeaders=await headers();
    const context=await resolveTenantContext(requestHeaders);
    requirePermission(context,"billing:write");
    if((context.role!=="owner"&&context.role!=="admin")||
       !environmentIronControlTenantId()||
       context.tenantId!==environmentIronControlTenantId()){
      return NextResponse.json({error:"billing.iron_payer_scope_denied"},{status:403});
    }
    const body:unknown=await request.json();
    if(!body||typeof body!=="object"||Array.isArray(body)){
      return NextResponse.json({error:"billing.iron_payer_invalid_request"},{status:400});
    }
    const input=body as Record<string,unknown>;
    if(typeof input.password!=="string"||typeof input.gymId!=="string"||
       typeof input.name!=="string"||typeof input.cpfCnpj!=="string"||
       (input.email!==undefined&&typeof input.email!=="string")){
      return NextResponse.json({error:"billing.iron_payer_invalid_request"},{status:400});
    }
    const stepUp=await verifyPasswordStepUp(requestHeaders,input.password);
    if(stepUp.userId!==context.userId){
      return NextResponse.json({error:"security.step_up_required"},{status:403});
    }
    const {productId}=await params;
    const result=await new GovernedIronPayerEnrollment(
      new PostgresIronPayerEnrollment(pool),new AsaasCheckoutClient(),
    ).enroll({
      tenantId:context.tenantId,productId,gymId:input.gymId,
      name:input.name,cpfCnpj:input.cpfCnpj,
      ...(input.email!==undefined?{email:input.email}:{}),
    });
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch{
    // Never reflect names, CPF/CNPJ, provider payloads or errors to clients.
    return NextResponse.json({error:"billing.iron_payer_enrollment_requires_review"},{status:409});
  }
}
