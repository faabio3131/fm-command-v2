import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildReportService, metricNameFor } from "@/application/reports/report-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { reportErrorResponse } from "../../error-response";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { id } = await params;
    return NextResponse.json(await buildReportService().sendNow(context, id, randomUUID(), metricNameFor));
  } catch (error) { return reportErrorResponse(error); }
}
