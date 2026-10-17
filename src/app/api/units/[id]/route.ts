import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildUnitAdminService } from "@/application/organization/unit-admin-composition";
import { UnitInputError } from "@/application/organization/unit-admin-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { unitErrorResponse } from "../error-response";

/** Renomeia e/ou move (name, parentId). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { name?: string; parentId?: string } | null;
    if (!body || (body.name === undefined && body.parentId === undefined)) throw new UnitInputError("unit.invalid_body");
    const service = buildUnitAdminService();
    let unit;
    if (body.name !== undefined) unit = await service.rename(context, id, body.name);
    if (body.parentId !== undefined) unit = await service.move(context, id, body.parentId);
    return NextResponse.json({ unit });
  } catch (error) { return unitErrorResponse(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    await buildUnitAdminService().remove(context, id);
    return NextResponse.json({ removed: true });
  } catch (error) { return unitErrorResponse(error); }
}
