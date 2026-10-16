import { NextResponse } from "next/server";
import { SectorPackNotEnabledError, SectorPackNotFoundError } from "@/application/sectors/sector-service";
import { ReportInputError, ReportLimitError } from "@/application/reports/report-service";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export function sectorErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof SectorPackNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof SectorPackNotEnabledError || error instanceof ReportLimitError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof ReportInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
}
