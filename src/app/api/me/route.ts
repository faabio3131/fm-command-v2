import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
export async function GET(request: Request){
  try {
    const c=await resolveTenantContext(request.headers);
    return NextResponse.json({userId:c.userId,tenantId:c.tenantId,role:c.role,correlationId:c.correlationId});
  } catch(error){
    if(error instanceof AuthenticationRequiredError) return NextResponse.json({error:error.message},{status:401});
    if(error instanceof TenantScopeRequiredError) return NextResponse.json({error:error.message},{status:403});
    return NextResponse.json({error:"internal_error"},{status:500});
  }
}
