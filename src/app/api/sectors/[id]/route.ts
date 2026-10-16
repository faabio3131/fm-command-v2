import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildSectorService } from "@/application/sectors/sector-composition";
import { SectorPackNotFoundError } from "@/application/sectors/sector-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { sectorErrorResponse } from "../error-response";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") throw new SectorPackNotFoundError();
    await buildSectorService().setEnabled(context, id, body.enabled);
    return NextResponse.json({ ok: true });
  } catch (error) { return sectorErrorResponse(error); }
}
