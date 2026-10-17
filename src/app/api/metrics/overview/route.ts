import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createMetricService } from "@/application/metrics/metric-composition";
import { parsePeriodKind } from "@/domain/metrics/period";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const service = createMetricService();
    const overview = await service.overview(context, undefined, undefined, parsePeriodKind(new URL(request.url).searchParams.get("period")));
    return NextResponse.json(overview);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
