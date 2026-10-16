import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildSourceConfigurationService } from "@/application/integration/source-configuration-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { configErrorResponse } from "../sources/config-errors";

/** Catálogo: quais sistemas a empresa pode conectar e o que cada um pede. */
export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    return NextResponse.json(buildSourceConfigurationService().catalog(context));
  } catch (error) {
    return configErrorResponse(error);
  }
}
