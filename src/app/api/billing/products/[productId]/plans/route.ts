import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { ProductBillingAuthorityService, BillingProductInputError } from "@/application/billing/product-billing-authority-service";
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
    const service = new ProductBillingAuthorityService(new PostgresProductBillingAuthorityRepository());
    return NextResponse.json(await service.listPlans(context, productId));
  } catch (error) {
    const response = securityResponse(error);
    if (response) return response;
    return NextResponse.json({ error: "billing.plans_unavailable" }, { status: 409 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
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
    if (typeof input.password !== "string" || typeof input.planCode !== "string" ||
        typeof input.name !== "string" || typeof input.interval !== "string" ||
        typeof input.amountMinor !== "number")
      return NextResponse.json({ error: "billing.product_input_invalid" }, { status: 400 });
    const proof = await verifyPasswordStepUp(requestHeaders, input.password);
    if (proof.userId !== context.userId)
      return NextResponse.json({ error: "security.step_up_required" }, { status: 403 });
    const { productId } = await params;
    const plan = await new ProductBillingAuthorityService(new PostgresProductBillingAuthorityRepository()).upsertPlan(context, productId, {
      planCode: input.planCode,
      name: input.name,
      interval: input.interval as "monthly" | "yearly",
      amountMinor: input.amountMinor,
      status: input.status as "active" | "inactive" | undefined,
    });
    await recordAuditEvent(context, {
      action: "billing.product_plan.upsert",
      resourceType: "billing_product_plan",
      resourceId: plan.id,
      result: "success",
      metadata: { productId, planCode: plan.planCode, interval: plan.interval, amountMinor: plan.amountMinor, status: plan.status },
    });
    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    const response = securityResponse(error);
    if (response) return response;
    if (error instanceof BillingProductInputError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "billing.plan_write_failed" }, { status: 409 });
  }
}
