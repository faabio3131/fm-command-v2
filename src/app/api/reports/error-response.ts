import { NextResponse } from "next/server";
import { ReportInputError, ReportLimitError, ReportNotFoundError } from "@/application/reports/report-service";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export function reportErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ReportInputError) return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
  if (error instanceof ReportNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof ReportLimitError) return NextResponse.json({ error: error.message }, { status: 409 });
  throw error;
}
