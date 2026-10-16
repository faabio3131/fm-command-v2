import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { IronPaidLicenseReconciliationService } from "@/application/billing/iron-paid-license-reconciliation-service";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { verifyPasswordStepUp } from "@/application/security/password-step-up";
import { requirePermission } from "@/domain/security/tenant-context";
import { PostgresPaidIronInvoiceRepository } from "@/infrastructure/billing/postgres-paid-iron-invoice-repository";
import {
  IRON_COMMERCIAL_SOURCE_TYPE,
  IronCommercialConnector,
} from "@/infrastructure/integration/iron-commercial-connector";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";

export const dynamic = "force-dynamic";

/**
 * Privileged manual reconciliation until Command's payment outbox is certified.
 * Disabled by default; no client-facing SaaS endpoint and no gateway callback.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  if (process.env.FMCC_IRON_PAID_LICENSE_RECONCILIATION_ENABLED !== "YES") {
    return NextResponse.json({ error: "billing.iron_reconciliation_disabled" }, { status: 503 });
  }

  let context: Awaited<ReturnType<typeof resolveTenantContext>> | undefined;
  try {
    const requestHeaders = await headers();
    context = await resolveTenantContext(requestHeaders);
    requirePermission(context, "billing:write");
    if (context.role !== "owner" && context.role !== "admin") {
      return NextResponse.json({ error: "billing.admin_required" }, { status: 403 });
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "billing.invalid_request" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    if (typeof input.password !== "string" || typeof input.invoiceId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.invoiceId)) {
      return NextResponse.json({ error: "billing.invalid_request" }, { status: 400 });
    }

    const proof = await verifyPasswordStepUp(requestHeaders, input.password);
    if (proof.userId !== context.userId) {
      return NextResponse.json({ error: "security.step_up_required" }, { status: 403 });
    }

    const { productId } = await params;
    const sources = (await new PostgresSourceRepository().list(context.tenantId)).filter(
      (source) => source.productId === productId && source.sourceType === IRON_COMMERCIAL_SOURCE_TYPE,
    );
    if (sources.length !== 1) {
      return NextResponse.json({ error: "billing.iron_source_missing_or_ambiguous" }, { status: 409 });
    }

    const result = await new IronPaidLicenseReconciliationService(
      new PostgresPaidIronInvoiceRepository(), new IronCommercialConnector(),
    ).reconcile(context, sources[0], productId, input.invoiceId);

    await recordAuditEvent(context, {
      action: "billing.iron_license.reconcile_paid",
      resourceType: "billing_invoice",
      resourceId: result.invoiceId,
      result: "success",
      metadata: {
        productId,
        externalTenantId: result.gymId,
        ironSubscriptionId: result.ironSubscriptionId,
        mappingRevision: result.mappingRevision,
        ironPlanCode: result.ironPlanCode,
        ironPlanVersion: result.ironPlanVersion,
      },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (context) {
      await recordAuditEvent(context, {
        action: "billing.iron_license.reconcile_paid",
        resourceType: "billing_invoice",
        result: "failure",
        metadata: { errorType: error instanceof Error ? error.name : "unknown" },
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: "billing.iron_reconciliation_denied_or_failed" }, { status: 403 });
  }
}
