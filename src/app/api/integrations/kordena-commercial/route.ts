import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { KordenaCommercialControlService } from "@/application/integration/kordena-commercial-control-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  AuthenticationRequiredError,
  CrossTenantAccessError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

export async function GET(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const sourceId = new URL(request.url).searchParams.get("sourceId")?.trim();
    if (!sourceId) {
      return NextResponse.json(
        { error: "integration.source_id_required" },
        { status: 400 },
      );
    }
    const snapshot = await new KordenaCommercialControlService().snapshot(
      context,
      sourceId,
    );
    return NextResponse.json(snapshot);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError ||
      error instanceof CrossTenantAccessError
    ) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "integration.kordena_snapshot_failed" },
      { status: 502 },
    );
  }
}
