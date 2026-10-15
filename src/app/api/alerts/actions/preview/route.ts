import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { AlertActionInvalidError, AlertOccurrenceNotFoundError } from "@/application/alerts/alert-service";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import type { GovernedActionType } from "@/domain/alerts/contracts";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";

export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = await request.json() as { occurrenceId?: unknown; actionType?: unknown; idempotencyKey?: unknown };
    if (typeof body.occurrenceId !== "string" || typeof body.actionType !== "string" || typeof body.idempotencyKey !== "string") {
      throw new AlertActionInvalidError();
    }
    return NextResponse.json(await buildAlertService().prepareAction(context, {
      occurrenceId: body.occurrenceId,
      actionType: body.actionType as GovernedActionType,
      idempotencyKey: body.idempotencyKey,
    }));
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof AlertOccurrenceNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof AlertActionInvalidError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
