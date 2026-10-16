import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildReportService } from "@/application/reports/report-composition";
import { ReportInputError } from "@/application/reports/report-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { reportErrorResponse } from "../error-response";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.enabled !== "boolean") throw new ReportInputError("enabled");
    await buildReportService().setEnabled(context, id, body.enabled);
    return NextResponse.json({ ok: true });
  } catch (error) { return reportErrorResponse(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    await buildReportService().remove(context, id);
    return NextResponse.json({ ok: true });
  } catch (error) { return reportErrorResponse(error); }
}
