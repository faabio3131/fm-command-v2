import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { asyncCoreQueryService } from "@/application/core/core-runtime";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, CrossTenantAccessError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Estado de uma consulta ao Core. So quem enviou enxerga: outra pessoa, outra empresa ou id inexistente dao a mesma resposta 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    const status = await asyncCoreQueryService().status(context, id);
    if (!status) return NextResponse.json({ error: "core.query_not_found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ id, ...status }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: NO_STORE });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError || error instanceof CrossTenantAccessError)
      return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
    throw error;
  }
}
