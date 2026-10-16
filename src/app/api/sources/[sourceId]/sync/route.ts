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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  let context: TenantContext | null = null;
  let sourceId: string | null = null;

  try {
    const requestHeaders = await headers();
    context = await resolveTenantContext(requestHeaders);
    ({ sourceId } = await params);

    const idempotencyKey =
      requestHeaders.get("idempotency-key")?.trim() ?? "";
    if (!idempotencyKey || idempotencyKey.length > 192) {
      return NextResponse.json(
        { error: "integration.idempotency_key_invalid" },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      cursor?: unknown;
    };
    const result = await buildConnectorRuntime().syncPull(
      context,
      {
        sourceId,
        idempotencyKey,
        cursor:
          typeof body.cursor === "string"
            ? body.cursor
            : undefined,
      },
    );

    await recordAuditEvent(context, {
      action: "integration.sync.executed",
      resourceType: "integration_source",
      resourceId: sourceId,
      result: "success",
      metadata: {
        status: result.status,
        ingested: result.ingested,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (context && sourceId) {
      await recordAuditEvent(context, {
        action: "integration.sync.executed",
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
      { error: "integration.sync_failed" },
      { status: 502 },
    );
  }
}
