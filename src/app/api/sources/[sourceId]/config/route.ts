import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { buildSourceConfigurationService } from "@/application/integration/source-configuration-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { configErrorResponse } from "../../config-errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Atualiza só os campos de configuração permitidos (moeda, fuso, mapa de unidades, limites, variáveis). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  try {
    const context = await resolveTenantContext(await headers());
    const { sourceId } = await params;
    if (!UUID.test(sourceId)) return NextResponse.json({ error: "integration.source_not_found" }, { status: 404 });
    const body = (await request.json().catch(() => null)) as { config?: unknown } | null;
    const config = await buildSourceConfigurationService().updateConfig(context, sourceId, body?.config);
    await recordAuditEvent(context, {
      action: "integration.source.configured",
      resourceType: "integration_source",
      resourceId: sourceId,
      result: "success",
      metadata: { fields: Object.keys((body?.config as object) ?? {}) },
    });
    return NextResponse.json({ config });
  } catch (error) {
    return configErrorResponse(error);
  }
}
