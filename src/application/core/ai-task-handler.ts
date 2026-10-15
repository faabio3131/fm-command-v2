import { ProviderBadRequestError } from "@/domain/core/ai-provider";
import type { TaskHandler } from "./work-worker";
import { PermanentTaskError } from "./work-worker";
import type { ProviderRouter } from "./provider-router";

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : null;
}

/**
 * Executor da fila para tarefas de IA (analysis, synthesis, attendance...): le {system, user, maxTokens} do payload e
 * pede ao roteador. Pedido invalido vai direto para "dead"; falta de provedor e falha de provedor sao repetidas pela fila.
 * Entrega "pelo menos uma vez": se a posse se perder depois da resposta, outra execucao pode repetir (e cobrar) a chamada.
 */
export function createAiTaskHandler(router: ProviderRouter): TaskHandler {
  return async (item, signal) => {
    const system = str(item.payload.system, 20_000);
    const user = str(item.payload.user, 200_000);
    const maxTokens = Number(item.payload.maxTokens ?? 1024);
    if (!system || !user || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32_000)
      throw new PermanentTaskError("ai.task_payload_invalid");
    try {
      const out = await router.execute({
        tenantId: item.tenantId, unitId: item.unitId, taskId: item.id, attempt: item.attempt, taskType: item.taskType,
        request: { system, user, maxTokens }, signal,
      });
      return { text: out.text, providerId: out.providerId, role: out.role, model: out.model, tokensIn: out.tokensIn, tokensOut: out.tokensOut, costMicroMinor: out.costMicroMinor, currency: out.currency, attempted: out.attempted };
    } catch (e) {
      if (e instanceof ProviderBadRequestError) throw new PermanentTaskError(e.code);
      throw e;
    }
  };
}
