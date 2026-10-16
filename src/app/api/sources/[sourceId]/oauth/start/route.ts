import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { buildOAuthConnectionService } from "@/application/integration/oauth-composition";
import { SourceNotFoundError } from "@/application/integration/oauth-connection-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { OAuthProviderNotConfiguredError } from "@/domain/integration/oauth";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

/** Inicia a ligação da conta do ERP: devolve o endereço de autorização do provedor. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  try {
    const context = await resolveTenantContext(await headers());
    const { sourceId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId)) {
      return NextResponse.json({ error: "integration.source_not_found" }, { status: 404 });
    }
    const { authorizeUrl } = await buildOAuthConnectionService().start(context, sourceId);
    await recordAuditEvent(context, {
      action: "integration.oauth.started",
      resourceType: "integration_source",
      resourceId: sourceId,
      result: "success",
      metadata: {},
    });
    return NextResponse.json({ authorizeUrl });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof SourceNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof OAuthProviderNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "integration.oauth_start_failed" }, { status: 500 });
  }
}
