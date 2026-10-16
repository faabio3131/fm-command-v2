import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requirePermission,
  TenantScopeRequiredError,
} from "@/domain/security/tenant-context";
import { PostgresCredentialStore } from "@/infrastructure/integration/postgres-credential-store";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";

const API_KEY_SOURCE_TYPES = new Set(["omie"]);

/**
 * O cliente cola a chave do ERP dele. A resposta nunca devolve o segredo:
 * só confirma que existe uma credencial guardada.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  try {
    const context = await resolveTenantContext(await headers());
    requirePermission(context, "source:write");
    const { sourceId } = await params;
    const sources = new PostgresSourceRepository();
    const source = await sources.findById(context.tenantId, sourceId);
    if (!source) {
      return NextResponse.json({ error: "integration.source_not_found" }, { status: 404 });
    }
    if (!API_KEY_SOURCE_TYPES.has(source.sourceType)) {
      return NextResponse.json({ error: "integration.credential_kind_not_supported" }, { status: 400 });
    }
    const body = (await request.json().catch(() => null)) as {
      kind?: unknown;
      appKey?: unknown;
      appSecret?: unknown;
    } | null;
    const valid =
      body?.kind === "api_key_pair" &&
      typeof body.appKey === "string" && body.appKey.trim().length >= 1 && body.appKey.length <= 200 &&
      typeof body.appSecret === "string" && body.appSecret.trim().length >= 1 && body.appSecret.length <= 500;
    if (!valid) {
      return NextResponse.json({ error: "integration.credential_invalid" }, { status: 400 });
    }
    const secretRef = `vault:source-${source.id}`;
    await new PostgresCredentialStore().save(context.tenantId, secretRef, {
      kind: "api_key_pair",
      appKey: (body.appKey as string).trim(),
      appSecret: (body.appSecret as string).trim(),
    });
    await sources.attachSecretRef(context.tenantId, source.id, secretRef);
    await recordAuditEvent(context, {
      action: "integration.credential.stored",
      resourceType: "integration_source",
      resourceId: source.id,
      result: "success",
      metadata: { kind: "api_key_pair" },
    });
    return NextResponse.json({ stored: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "integration.credential_store_failed" }, { status: 500 });
  }
}
