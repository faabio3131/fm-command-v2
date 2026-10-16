import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { AlertOccurrenceNotFoundError } from "@/application/alerts/alert-service";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = await request.json() as { occurrenceId?: unknown };
    if (typeof body.occurrenceId !== "string" || !body.occurrenceId.trim()) {
      return NextResponse.json({ error: "alert.occurrence_not_found" }, { status: 400 });
    }
    return NextResponse.json(await buildAlertService().acknowledge(context, body.occurrenceId));
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof AlertOccurrenceNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
