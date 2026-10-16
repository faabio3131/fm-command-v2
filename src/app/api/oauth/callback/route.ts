import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { buildOAuthConnectionService } from "@/application/integration/oauth-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { serverEnv } from "@/config/env";
import type { TenantContext } from "@/domain/security/tenant-context";

function back(result: "connected" | "error") {
  return NextResponse.redirect(new URL(`/dashboard/sources?oauth=${result}`, serverEnv().authUrl));
}

/**
 * Retorno do provedor. Nunca ecoa `code`, `state` nem mensagem de erro do
 * provedor: o resultado é só "connected" ou "error".
 */
export async function GET(request: Request) {
  let context: TenantContext | null = null;
  let sourceId: string | undefined;
  try {
    context = await resolveTenantContext(await headers());
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (url.searchParams.get("error") || !code || !state || code.length > 2048 || state.length > 256) return back("error");
    ({ sourceId } = await buildOAuthConnectionService().complete(context, { code, state }));
    await recordAuditEvent(context, {
      action: "integration.oauth.connected",
      resourceType: "integration_source",
      resourceId: sourceId,
      result: "success",
      metadata: {},
    });
    return back("connected");
  } catch (error) {
    if (context) {
      await recordAuditEvent(context, {
        action: "integration.oauth.connected",
        resourceType: "integration_source",
        resourceId: sourceId ?? "unknown",
        result: "failure",
        metadata: { errorType: error instanceof Error ? error.name : "UnknownError" },
      }).catch(() => undefined);
    }
    return back("error");
  }
}
