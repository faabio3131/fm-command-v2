import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildUnitAdminService } from "@/application/organization/unit-admin-composition";
import { UnitInputError } from "@/application/organization/unit-admin-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { unitErrorResponse } from "../error-response";

/** Troca de uma vez as unidades que a pessoa enxerga: { userId, unitIds }. */
export async function PUT(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = (await request.json().catch(() => null)) as { userId?: string; unitIds?: unknown } | null;
    if (!body || typeof body.userId !== "string" || !Array.isArray(body.unitIds) || body.unitIds.some((x) => typeof x !== "string")) throw new UnitInputError("unit.invalid_body");
    await buildUnitAdminService().setGrants(context, body.userId, body.unitIds as string[]);
    return NextResponse.json({ updated: true });
  } catch (error) { return unitErrorResponse(error); }
}
