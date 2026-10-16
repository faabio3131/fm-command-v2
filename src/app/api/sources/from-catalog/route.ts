import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { buildSourceConfigurationService } from "@/application/integration/source-configuration-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { configErrorResponse } from "../config-errors";

/** Cria uma fonte a partir de um item do catálogo; a configuração é validada pelo servidor. */
export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.connectorId !== "string" || typeof body.name !== "string") {
      return NextResponse.json({ error: "integration.source_definition_invalid" }, { status: 400 });
    }
    const source = await buildSourceConfigurationService().createFromCatalog(context, {
      connectorId: body.connectorId,
      name: body.name,
      productId: typeof body.productId === "string" ? body.productId : undefined,
      freshnessSeconds: typeof body.freshnessSeconds === "number" ? body.freshnessSeconds : undefined,
      config: body.config,
    });
    await recordAuditEvent(context, {
      action: "integration.source.registered",
      resourceType: "integration_source",
      resourceId: source.id,
      result: "success",
      metadata: { sourceType: source.sourceType, viaCatalog: true },
    });
    const { secretRef, ...safe } = source;
    return NextResponse.json({ ...safe, hasSecretReference: Boolean(secretRef) }, { status: 201 });
  } catch (error) {
    return configErrorResponse(error);
  }
}
