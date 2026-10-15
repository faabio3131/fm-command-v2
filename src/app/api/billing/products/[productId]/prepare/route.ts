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

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  let context: Awaited<ReturnType<typeof resolveTenantContext>> | undefined;
  try {
    const requestHeaders = await headers();
    context = await resolveTenantContext(requestHeaders);
    if (context.role !== "owner" && context.role !== "admin")
      return NextResponse.json({ error: "billing.admin_required" }, { status: 403 });

    const idempotencyKey = requestHeaders.get("x-idempotency-key")?.trim() ?? "";
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ error: "billing.product_input_invalid" }, { status: 400 });
    const input = body as Record<string, unknown>;
    if (typeof input.password !== "string" || typeof input.externalTenantId !== "string" || typeof input.planCode !== "string")
      return NextResponse.json({ error: "billing.product_input_invalid" }, { status: 400 });

    const proof = await verifyPasswordStepUp(requestHeaders, input.password);
    if (proof.userId !== context.userId)
      return NextResponse.json({ error: "security.step_up_required" }, { status: 403 });

    const { productId } = await params;
    const prepared = await new ProductBillingAuthorityService(new PostgresProductBillingAuthorityRepository()).prepareSubscriptionInvoice(
      context,
      productId,
      { externalTenantId: input.externalTenantId, planCode: input.planCode, idempotencyKey },
    );
    await recordAuditEvent(context, {
      action: "billing.subscription_invoice.prepare",
      resourceType: "billing_invoice",
      resourceId: prepared.invoiceId,
      result: "success",
      metadata: {
        productId,
        customerId: prepared.customerId,
        subscriptionId: prepared.subscriptionId,
        planCode: prepared.planCode,
        amountMinor: prepared.amountMinor,
        gatewayAccountId: prepared.gatewayAccountId,
        idempotentReplay: prepared.idempotentReplay,
      },
    });
    return NextResponse.json(prepared, { status: prepared.idempotentReplay ? 200 : 201 });
  } catch (error) {
    const response = securityResponse(error);
    if (response) return response;
    if (error instanceof BillingProductInputError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "billing.prepare_failed" }, { status: 409 });
  }
}
