import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import { verifyPasswordStepUp } from "@/application/security/password-step-up";
import { requirePermission } from "@/domain/security/tenant-context";
import { IronPlanMappingError } from "@/domain/billing/iron-versioned-plan-mapping";
import { PostgresIronPlanMappingRepository } from "@/infrastructure/billing/postgres-iron-plan-mapping-repository";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";

export const dynamic = "force-dynamic";

async function singleIronSource(tenantId: string, productId: string) {
  const sources = (await new PostgresSourceRepository().list(tenantId)).filter(
    (source) => source.productId === productId && source.sourceType === "iron-commercial-v1" &&
      source.name === "IRON FIT CORE Commercial" &&
      source.authoritativeDomain === "commercial",
  );
  if (sources.length !== 1) throw new Error("billing.iron_mapping_source_missing_or_ambiguous");
  return sources[0];
}

export async function GET(
  _request: Request, { params }: { params: Promise<{ productId: string }> },
) {
  try {
    const context = await resolveTenantContext(await headers());
    requirePermission(context, "billing:read");
    if (context.role !== "owner" && context.role !== "admin") {
      return NextResponse.json({ error: "billing.admin_required" }, { status: 403 });
    }
    const { productId } = await params;
    const source = await singleIronSource(context.tenantId, productId);
    const mappings = await new PostgresIronPlanMappingRepository().list(context.tenantId, productId, source.id);
    return NextResponse.json({ mappings }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "billing.iron_mapping_access_denied" }, { status: 403 });
  }
}

/**
 * Governed, append-only map registration. No arbitrary remapping of a
 * commercial plan that might already be associated with a paid invoice.
 */
export async function POST(
  request: Request, { params }: { params: Promise<{ productId: string }> },
) {
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
      return NextResponse.json({ error: "billing.iron_mapping_input_invalid" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    if (typeof input.password !== "string" || typeof input.commercialPlanCode !== "string" ||
        typeof input.ironPlanCode !== "string" || typeof input.ironPlanVersion !== "number") {
      return NextResponse.json({ error: "billing.iron_mapping_input_invalid" }, { status: 400 });
    }

    const proof = await verifyPasswordStepUp(requestHeaders, input.password);
    if (proof.userId !== context.userId) {
      return NextResponse.json({ error: "security.step_up_required" }, { status: 403 });
    }

    const { productId } = await params;
    const source = await singleIronSource(context.tenantId, productId);
    const result = await new PostgresIronPlanMappingRepository().register(
      context.tenantId, productId, source.id, {
        commercialPlanCode: input.commercialPlanCode,
        ironPlanCode: input.ironPlanCode,
        ironPlanVersion: input.ironPlanVersion,
      },
    );
    await recordAuditEvent(context, {
      action: "billing.iron_plan_mapping.register",
      resourceType: "integration_source",
      resourceId: source.id,
      result: "success",
      metadata: { productId, ...result.mapping, created: result.created },
    });
    return NextResponse.json(result, {
      status: result.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (context) {
      await recordAuditEvent(context, {
        action: "billing.iron_plan_mapping.register",
        resourceType: "integration_source",
        result: "failure",
        metadata: { errorType: error instanceof Error ? error.name : "unknown" },
      }).catch(() => undefined);
    }
    if (error instanceof IronPlanMappingError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "billing.iron_mapping_denied_or_failed" }, { status: 403 });
  }
}
