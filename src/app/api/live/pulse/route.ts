import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createUnitScopeResolver } from "@/application/organization/unit-scope";
import { LivePulseService } from "@/application/live/live-pulse-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresLivePulseRepository } from "@/infrastructure/live/postgres-live-pulse-repository";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    const pulse = await new LivePulseService(new PostgresLivePulseRepository(), createUnitScopeResolver()).pulse(context);
    return NextResponse.json(pulse, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: NO_STORE });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
    }
    throw error;
  }
}
