import { NextResponse } from "next/server";
import { UnitInputError, UnitInUseError, UnitNotFoundError, UnitProtectedError, UnitValidationError } from "@/application/organization/unit-admin-service";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export function unitErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof UnitNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof UnitInUseError || error instanceof UnitProtectedError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof UnitInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof UnitValidationError) return NextResponse.json({ error: "organization.unit_invalid", details: error.errors }, { status: 400 });
  throw error;
}
