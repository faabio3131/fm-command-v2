import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { buildConnectorRuntime } from "@/application/integration/connector-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import type { TenantContext } from "@/domain/security/tenant-context";
import {
  AuthenticationRequiredError,
  CrossTenantAccessError,
  PermissionDeniedError,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  let context: TenantContext | null = null;
  let sourceId: string | null = null;

  try {
    context = await resolveTenantContext(await headers());
    ({ sourceId } = await params);

    const status = await buildConnectorRuntime().health(
      context,
      sourceId,
    );

    await recordAuditEvent(context, {
      action: "integration.health.checked",
      resourceType: "integration_source",
      resourceId: sourceId,
      result: status === "healthy" ? "success" : "failure",
      metadata: { status },
    });

    return NextResponse.json({ status });
  } catch (error) {
    if (context && sourceId) {
      await recordAuditEvent(context, {
        action: "integration.health.checked",
        resourceType: "integration_source",
        resourceId: sourceId,
        result: "failure",
        metadata: {
          errorType:
            error instanceof Error
              ? error.name
              : "UnknownError",
        },
      }).catch(() => undefined);
    }

    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 },
      );
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError ||
      error instanceof CrossTenantAccessError
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "integration.health_failed" },
      { status: 502 },
    );
  }
}
