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
import { catalogEntry } from "@/infrastructure/connectors/catalog";
import { PostgresCredentialStore } from "@/infrastructure/integration/postgres-credential-store";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";

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
    const authType = catalogEntry(source.sourceType)?.authType;
    if (authType !== "api_key_pair" && authType !== "api_key") {
      return NextResponse.json({ error: "integration.credential_kind_not_supported" }, { status: 400 });
    }
    const body = (await request.json().catch(() => null)) as {
      kind?: unknown;
      appKey?: unknown;
      appSecret?: unknown;
      apiKey?: unknown;
    } | null;
    const str = (v: unknown, max: number) => typeof v === "string" && v.trim().length >= 1 && v.length <= max;
    let credential:
      | { kind: "api_key_pair"; appKey: string; appSecret: string }
      | { kind: "api_key"; apiKey: string }
      | undefined;
    if (authType === "api_key_pair" && body?.kind === "api_key_pair" && str(body.appKey, 200) && str(body.appSecret, 500)) {
      credential = { kind: "api_key_pair", appKey: (body.appKey as string).trim(), appSecret: (body.appSecret as string).trim() };
    } else if (authType === "api_key" && body?.kind === "api_key" && str(body.apiKey, 1000)) {
      credential = { kind: "api_key", apiKey: (body.apiKey as string).trim() };
    }
    if (!credential) {
      return NextResponse.json({ error: "integration.credential_invalid" }, { status: 400 });
    }
    const secretRef = `vault:source-${source.id}`;
    await new PostgresCredentialStore().save(context.tenantId, secretRef, credential);
    await sources.attachSecretRef(context.tenantId, source.id, secretRef);
    await recordAuditEvent(context, {
      action: "integration.credential.stored",
      resourceType: "integration_source",
      resourceId: source.id,
      result: "success",
      metadata: { kind: credential.kind },
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
