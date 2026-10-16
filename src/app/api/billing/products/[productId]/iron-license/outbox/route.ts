import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { GovernedIronOutboxDispatcher } from "@/application/billing/governed-iron-outbox-dispatcher";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { verifyPasswordStepUp } from "@/application/security/password-step-up";
import { requirePermission } from "@/domain/security/tenant-context";
import { pool } from "@/infrastructure/db/client";
import { PostgresIronEntitlementOutbox, type IronLicenseEvent } from "@/infrastructure/billing/postgres-iron-entitlement-outbox";
import {
  environmentIronControlTenantId,
  IronCommercialConnector,
  IRON_COMMERCIAL_SECRET_REF,
  IRON_COMMERCIAL_SOURCE_TYPE,
} from "@/infrastructure/integration/iron-commercial-connector";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";

export const dynamic = "force-dynamic";

const EVENTS = new Set(["LICENSE_ACTIVATE", "LICENSE_SUSPEND", "LICENSE_CANCEL"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  if (process.env.FMCC_IRON_OUTBOX_MANUAL_OPERATIONS_ENABLED !== "YES") {
    return NextResponse.json({ error: "billing.iron_outbox_disabled" }, { status: 503 });
  }
  let context: Awaited<ReturnType<typeof resolveTenantContext>> | undefined;
  let action = "unknown";
  try {
    const requestHeaders = await headers();
    context = await resolveTenantContext(requestHeaders);
    requirePermission(context, "billing:write");
    if ((context.role !== "admin" && context.role !== "owner") ||
        !environmentIronControlTenantId() || context.tenantId !== environmentIronControlTenantId()) {
      return NextResponse.json({ error: "billing.iron_outbox_scope_denied" }, { status: 403 });
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "billing.invalid_request" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    if (typeof input.password !== "string" || typeof input.action !== "string" ||
        (input.action !== "enqueue" && input.action !== "process_one")) {
      return NextResponse.json({ error: "billing.invalid_request" }, { status: 400 });
    }
    action = input.action;

    const proof = await verifyPasswordStepUp(requestHeaders, input.password);
    if (proof.userId !== context.userId) {
      return NextResponse.json({ error: "security.step_up_required" }, { status: 403 });
    }
    const { productId } = await params;
    const sources = (await new PostgresSourceRepository().list(context.tenantId)).filter(source =>
      source.productId === productId && source.sourceType === IRON_COMMERCIAL_SOURCE_TYPE &&
      source.secretRef === IRON_COMMERCIAL_SECRET_REF &&
      source.authoritativeDomain === "commercial" &&
      source.name === "IRON FIT CORE Commercial",
    );
    if (sources.length !== 1) {
      return NextResponse.json({ error: "billing.iron_source_missing_or_ambiguous" }, { status: 409 });
    }

    const outbox = new PostgresIronEntitlementOutbox(pool);
    let result: unknown;
    if (action === "enqueue") {
      if (typeof input.invoiceId !== "string" ||
          typeof input.eventType !== "string" || !EVENTS.has(input.eventType)) {
        return NextResponse.json({ error: "billing.invalid_request" }, { status: 400 });
      }
      result = await outbox.enqueue({
        tenantId: context.tenantId, productId, invoiceId: input.invoiceId,
        eventType: input.eventType as IronLicenseEvent,
      });
    } else {
      // Both independent flags are mandatory; manually enabling the queue
      // must never silently enable delivery to IRON.
      if (process.env.FMCC_IRON_OUTBOX_DELIVERY_ENABLED !== "YES" ||
          process.env.FMCC_IRON_PAID_LICENSE_RECONCILIATION_ENABLED !== "YES") {
        return NextResponse.json({ error: "billing.iron_outbox_delivery_disabled" }, { status: 503 });
      }
      result = await new GovernedIronOutboxDispatcher(outbox, new IronCommercialConnector())
        .processOne(context, sources[0], productId);
    }

    await recordAuditEvent(context, {
      action: "billing.iron_outbox." + action,
      resourceType: "billing_product",
      resourceId: productId,
      result: action === "process_one" && result && typeof result === "object" &&
        "status" in result && (result.status === "blocked" || result.status === "retry" || result.status === "lease_lost")
        ? "failure" : "success",
      metadata: { operation: action },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (context) {
      await recordAuditEvent(context, {
        action: "billing.iron_outbox." + action,
        resourceType: "billing_product",
        result: "failure",
        metadata: { errorType: error instanceof Error ? error.name : "unknown" },
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: "billing.iron_outbox_operation_denied" }, { status: 403 });
  }
}
