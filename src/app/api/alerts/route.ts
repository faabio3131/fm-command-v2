import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { AlertDefinitionInvalidError, AlertRuleDuplicateError } from "@/application/alerts/alert-service";
import { buildAlertService } from "@/application/alerts/alert-composition";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import type { AlertOperator, AlertSeverity } from "@/domain/alerts/contracts";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { ProductNotFoundError } from "@/application/products/product-registry-service";

function securityResponse(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return null;
}

export async function GET() {
  try {
    const context = await resolveTenantContext(await headers());
    return NextResponse.json(await buildAlertService().overview(context));
  } catch (error) {
    const response = securityResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveTenantContext(await headers());
    const body = await request.json() as {
      metricId?: unknown; productId?: unknown; operator?: unknown; threshold?: unknown;
      severity?: unknown; idempotencyKey?: unknown;
    };
    if (typeof body.metricId !== "string" || (body.productId !== undefined && typeof body.productId !== "string") ||
        typeof body.operator !== "string" || typeof body.threshold !== "string" ||
        typeof body.severity !== "string" || typeof body.idempotencyKey !== "string") {
      throw new AlertDefinitionInvalidError();
    }
    const result = await buildAlertService().createRule(context, {
      metricId: body.metricId,
      productId: body.productId,
      operator: body.operator as AlertOperator,
      threshold: body.threshold,
      severity: body.severity as AlertSeverity,
      idempotencyKey: body.idempotencyKey,
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    const response = securityResponse(error);
    if (response) return response;
    if (error instanceof ProductNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof AlertRuleDuplicateError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof AlertDefinitionInvalidError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
