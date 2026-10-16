import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildReportService } from "@/application/reports/report-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { reportErrorResponse } from "./error-response";

export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    return NextResponse.json({ reports: await buildReportService().list(context) });
  } catch (error) { return reportErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const report = await buildReportService().create(context, { name: body.name, metricIds: body.metricIds, frequency: body.frequency, hour: body.hour, weekday: body.weekday, dayOfMonth: body.dayOfMonth });
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) { return reportErrorResponse(error); }
}
