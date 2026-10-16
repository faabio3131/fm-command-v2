import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { buildCoreGateway } from "@/application/core/core-composition";
import { CoreArgumentError } from "@/application/core/core-gateway";
import { CoreReadCapabilityContractError } from "@/domain/core/read-capability";
import { resolveTenantContext } from "@/application/security/resolve-tenant-context";
import {
  AuthenticationRequiredError,
  CrossTenantAccessError,
  PermissionDeniedError,
  TenantScopeRequiredError,
  type TenantContext,
} from "@/domain/security/tenant-context";
import { CognitiveModelContractError, CognitiveModelUnavailableError } from "@/domain/core/cognitive-model";
import { logEvent } from "@/infrastructure/observability/logger";
import { aiServiceConfig, processRole } from "@/config/process-role";
import { sharedAiBridge } from "@/infrastructure/core/ai-service-client";

async function auditCoreQuery(context: TenantContext | null, result: "success" | "failure" | "denied", metadata: Record<string, unknown>) {
  if (!context) return;
  await recordAuditEvent(context, { action: "core.query", resourceType: "cognitive_core", result, metadata });
  const evidenceCount = Array.isArray(metadata.evidenceRefs) ? metadata.evidenceRefs.filter((item) => typeof item === "string").length : 0;
  logEvent("info", "core_query_audit_recorded", { result, correlationId: context.correlationId, evidenceCount });
}

export async function POST(request: Request) {
  // Processo de operação nunca chama o modelo (ADR-016): encaminha ao processo de IA ou recusa.
  if (processRole() === "operation") {
    const config = aiServiceConfig();
    if (!config) return NextResponse.json({ error: "core.ai_service_not_configured" }, { status: 503 });
    return sharedAiBridge(config).forward(request);
  }
  let context: TenantContext | null = null;
  try {
    context = await resolveTenantContext(await headers());
    const body = await request.json() as {
      question?: unknown;
      productSlugs?: unknown;
    };
    if (typeof body.question !== "string") throw new CoreArgumentError();
    if (
      body.productSlugs !== undefined &&
      (!Array.isArray(body.productSlugs) ||
        body.productSlugs.some((slug) => typeof slug !== "string"))
    ) {
      throw new CoreArgumentError();
    }
    const productSlugs = body.productSlugs as string[] | undefined;
    const answer = await buildCoreGateway().ask(context, body.question, {
      productSlugs,
    });
    await auditCoreQuery(context, "success", {
      question: body.question,
      answer: answer.answer,
      factualStatus: answer.factualStatus,
      evidenceRefs: answer.evidence.map((item) => item.ref),
      requestedProductSlugs: productSlugs ?? [],
      productRefs: [...new Set(answer.evidence.map((item) => item.productSlug).filter((item): item is string => Boolean(item)))],
    });
    return NextResponse.json(answer);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (
      error instanceof TenantScopeRequiredError ||
      error instanceof PermissionDeniedError ||
      error instanceof CrossTenantAccessError
    ) {
      await auditCoreQuery(context, "denied", { error: error.message });
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof CoreArgumentError) {
      await auditCoreQuery(context, "failure", { error: error.message });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      error instanceof CognitiveModelUnavailableError ||
      error instanceof CognitiveModelContractError ||
      error instanceof CoreReadCapabilityContractError
    ) {
      await auditCoreQuery(context, "failure", { error: error.message });
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
