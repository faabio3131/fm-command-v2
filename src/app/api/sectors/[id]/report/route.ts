import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { sectorErrorResponse } from "../../error-response";

/** Cria o relatório sugerido do pacote (uma vez só). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    return NextResponse.json(await buildSectorService().createSuggestedReport(context, id, await getRequestLocale()));
  } catch (error) { return sectorErrorResponse(error); }
}
