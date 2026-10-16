import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { sectorErrorResponse } from "./error-response";

export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    const overview = await buildSectorService().overview(context);
    return NextResponse.json({ packs: overview.map((o) => ({ id: o.pack.id, version: o.pack.version, label: o.pack.label, enabled: o.enabled, metrics: o.pack.metrics.length })) });
  } catch (error) { return sectorErrorResponse(error); }
}
