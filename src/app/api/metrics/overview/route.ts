import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createMetricService } from "@/application/metrics/metric-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    const service = createMetricService();
    const overview = await service.overview(context);
    return NextResponse.json(overview);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TenantScopeRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
