import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { BillingProductInputError, ProductBillingAuthorityService } from "@/application/billing/product-billing-authority-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { StepUpRequiredError, verifyPasswordStepUp } from "@/application/security/password-step-up";
import { AuthenticationRequiredError, PermissionDeniedError, TenantScopeRequiredError } from "@/domain/security/tenant-context";
import { PostgresProductBillingAuthorityRepository } from "@/infrastructure/billing/postgres-product-billing-authority-repository";

function securityResponse(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof TenantScopeRequiredError || error instanceof PermissionDeniedError || error instanceof StepUpRequiredError)
    return NextResponse.json({ error: error.message }, { status: 403 });
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const context = await resolveTenantContext(await headers());
    const { productId } = await params;
    const value = await new ProductBillingAuthorityService(new PostgresProductBillingAuthorityRepository()).getRoute(context, productId);
    return NextResponse.json(value);
  } catch (error) {
    const response = securityResponse(error);
    if (response) return response;
    return NextResponse.json({ error: "billing.route_unavailable" }, { status: 409 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  let context: Awaited<ReturnType<typeof resolveTenantContext>> | undefined;
  try {
    const requestHeaders = await headers();
    context = await resolveTenantContext(requestHeaders);
    if (context.role !== "owner" && context.role !== "admin")
      return NextResponse.json({ error: "billing.admin_required" }, { status: 403 });
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ error: "billing.product_input_invalid" }, { status: 400 });
    const input = body as Record<string, unknown>;
    if (typeof input.password !== "string" || typeof input.gatewayAccountId !== "string")
      return NextResponse.json({ error: "billing.product_input_invalid" }, { status: 400 });
    const proof = await verifyPasswordStepUp(requestHeaders, input.password);
    if (proof.userId !== context.userId)
      return NextResponse.json({ error: "security.step_up_required" }, { status: 403 });
    const { productId } = await params;
    const value = await new ProductBillingAuthorityService(new PostgresProductBillingAuthorityRepository()).configureRoute(
      context, productId, input.gatewayAccountId,
    );
    await recordAuditEvent(context, {
      action: "billing.product_route.configure",
      resourceType: "billing_product_route",
      resourceId: productId,
      result: "success",
      metadata: { productId, gatewayAccountId: value.gatewayAccountId, provider: value.provider, environment: value.environment },
    });
    return NextResponse.json(value);
  } catch (error) {
    const response = securityResponse(error);
    if (response) return response;
    if (error instanceof BillingProductInputError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "billing.route_write_failed" }, { status: 409 });
  }
}
