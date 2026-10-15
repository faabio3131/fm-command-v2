import { ProviderBadRequestError } from "@/domain/core/ai-provider";
import { needsHuman } from "@/domain/core/decision-response";
import { buildDecisionPrompt, DEFAULT_DECISION_THRESHOLD, interpretDecision, parseDecisionRequest } from "@/domain/core/decision-task";
import type { ProviderRouter } from "./provider-router";
import { PermanentTaskError, type TaskHandler } from "./work-worker";

/**
 * Executor da fila para o tipo "decision" (ADR-017): pedido fechado -> provedor da politica do banco -> resposta tipada com confianca.
 * `needsHuman` = confianca abaixo do limite; quem chamou decide se escala para o planejador completo ou para uma pessoa.
 * Pedido invalido vai direto para "dead". Saida invalida do modelo e repetida pela fila (pode ser um tropeco passageiro).
 */
export function createDecisionHandler(router: ProviderRouter, options: { threshold?: number } = {}): TaskHandler {
  const threshold = options.threshold ?? DEFAULT_DECISION_THRESHOLD;
  return async (item, signal) => {
    const req = parseDecisionRequest(item.payload);
    if (!req.ok) throw new PermanentTaskError(req.errors[0] ?? "decision.request_invalid");
    const prompt = buildDecisionPrompt(req.value);
    let out;
    try {
      out = await router.execute({
        tenantId: item.tenantId, unitId: item.unitId, taskId: item.id, attempt: item.attempt, taskType: "decision",
        request: prompt, signal,
      });
    } catch (e) {
      if (e instanceof ProviderBadRequestError) throw new PermanentTaskError(e.code);
      throw e;
    }
    const decision = interpretDecision(req.value, out.text);
    if (!decision.ok) throw new Error(`decision.model_output_invalid:${decision.errors[0] ?? "unknown"}`);
    return {
      decision: decision.value, needsHuman: needsHuman(decision.value, threshold), threshold,
      providerId: out.providerId, role: out.role, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut,
      costMicroMinor: out.costMicroMinor, currency: out.currency, attempted: out.attempted,
    };
  };
}
