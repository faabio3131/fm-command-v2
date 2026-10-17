import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildUnitAdminService } from "@/application/organization/unit-admin-composition";
import { UnitInputError } from "@/application/organization/unit-admin-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { unitErrorResponse } from "./error-response";

export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    return NextResponse.json(await buildUnitAdminService().overview(context));
  } catch (error) { return unitErrorResponse(error); }
}

/** kind "company" cria a matriz (uma só; devolve a existente); region e branch exigem parentId. */
export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = (await request.json().catch(() => null)) as { kind?: string; parentId?: string | null; name?: string; countryCode?: string; timezone?: string; currency?: string } | null;
    if (!body || typeof body.name !== "string" || !["company", "region", "branch"].includes(body.kind ?? "")) throw new UnitInputError("unit.invalid_body");
    const service = buildUnitAdminService();
    const profile = { countryCode: body.countryCode || undefined, timezone: body.timezone || undefined, currency: body.currency || undefined };
    if (body.kind === "company") {
      const { unit, created } = await service.ensureCompany(context, body.name, profile);
      return NextResponse.json({ unit, created }, { status: created ? 201 : 200 });
    }
    const unit = await service.create(context, { kind: body.kind as "region" | "branch", parentId: body.parentId ?? null, name: body.name, ...profile });
    return NextResponse.json({ unit }, { status: 201 });
  } catch (error) { return unitErrorResponse(error); }
}
