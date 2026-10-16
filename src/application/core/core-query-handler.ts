import { recordAuditEvent } from "@/application/audit/record-audit-event";
import { buildCoreGateway } from "@/application/core/core-composition";
import { CoreArgumentError, type CoreGateway } from "@/application/core/core-gateway";
import type { ProviderRouter } from "@/application/core/provider-router";
import { PermanentTaskError, type TaskHandler } from "@/application/core/work-worker";
import { CognitiveModelContractError, CognitiveModelUnavailableError, type CognitiveModel } from "@/domain/core/cognitive-model";
import { CoreReadCapabilityContractError } from "@/domain/core/read-capability";
import { normalizeRole } from "@/domain/security/permissions";
import { CrossTenantAccessError, PermissionDeniedError, TenantScopeRequiredError, type TenantContext } from "@/domain/security/tenant-context";
import { RoutedCognitiveModel } from "@/infrastructure/core/routed-cognitive-model";
import { logEvent } from "@/infrastructure/observability/logger";

export interface CoreQueryHandlerDeps {
  readonly router: ProviderRouter;
  /** Troca em teste. Padrao: monta o gateway real do Core com o modelo recebido (ou o da V1, se undefined). */
  readonly makeGateway?: (model: CognitiveModel | undefined) => CoreGateway;
}

async function audit(context: TenantContext, result: "success" | "failure" | "denied", metadata: Record<string, unknown>) {
  try { await recordAuditEvent(context, { action: "core.query", resourceType: "cognitive_core", result, metadata }); }
  catch (e) { logEvent("error", "core_query_audit_failed", { correlationId: context.correlationId, errorType: e instanceof Error ? e.name : "unknown" }); }
}

/**
 * Executa uma consulta ao Core fora da requisicao (ADR-016/018). O contexto de seguranca e remontado com a empresa da
 * coluna da fila (nao do payload) e com usuario e papel gravados pelo servidor autenticado no momento do envio.
 * Entrega "pelo menos uma vez": uma reentrega repete as chamadas de IA e a auditoria.
 */
export function createCoreQueryHandler(deps: CoreQueryHandlerDeps): TaskHandler {
  const makeGateway = deps.makeGateway ?? ((m) => buildCoreGateway(m));
  return async (item, signal) => {
    const p = item.payload;
    if (typeof p.question !== "string" || typeof p.userId !== "string" || !p.userId || typeof p.role !== "string" || typeof p.correlationId !== "string")
      throw new PermanentTaskError("core.argument_invalid");
    const productSlugs = Array.isArray(p.productSlugs) && p.productSlugs.every((s) => typeof s === "string") ? (p.productSlugs as string[]) : undefined;
    const context: TenantContext = { tenantId: item.tenantId, userId: p.userId, role: normalizeRole(p.role), correlationId: p.correlationId };
    const last = item.attempt >= item.maxAttempts;
    try {
      const routed = await deps.router.hasRoute(item.tenantId, "analysis") && await deps.router.hasRoute(item.tenantId, "synthesis");
      const model = routed ? new RoutedCognitiveModel(deps.router, { tenantId: item.tenantId, unitId: item.unitId, taskId: item.id, attempt: item.attempt, signal }) : undefined;
      const answer = await makeGateway(model).ask(context, p.question, { productSlugs });
      await audit(context, "success", {
        question: p.question, answer: answer.answer, factualStatus: answer.factualStatus, evidenceRefs: answer.evidence.map((e) => e.ref),
        requestedProductSlugs: productSlugs ?? [], mode: "async", taskId: item.id,
      });
      return { answer };
    } catch (e) {
      if (e instanceof PermissionDeniedError || e instanceof CrossTenantAccessError || e instanceof TenantScopeRequiredError) {
        await audit(context, "denied", { error: (e as Error).message, mode: "async", taskId: item.id });
        throw new PermanentTaskError((e as Error).message);
      }
      if (e instanceof CoreArgumentError) { await audit(context, "failure", { error: e.message, mode: "async", taskId: item.id }); throw new PermanentTaskError(e.message); }
      if (e instanceof CognitiveModelContractError || e instanceof CoreReadCapabilityContractError) {
        await audit(context, "failure", { error: (e as Error).message, mode: "async", taskId: item.id });
        throw new PermanentTaskError((e as Error).message);
      }
      if (e instanceof CognitiveModelUnavailableError) {
        if (last) await audit(context, "failure", { error: e.message, mode: "async", taskId: item.id });
        throw e; // a fila repete
      }
      throw e;
    }
  };
}
