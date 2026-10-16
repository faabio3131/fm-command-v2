import { CognitiveModelContractError, CognitiveModelUnavailableError } from "@/domain/core/cognitive-model";
import { ProviderBadRequestError } from "@/domain/core/ai-provider";
import type { ProviderRouter } from "@/application/core/provider-router";
import { LlmCognitiveModel } from "./openai-compatible-cognitive-model";
import { logEvent } from "@/infrastructure/observability/logger";

export interface RoutedModelContext {
  readonly tenantId: string;
  readonly unitId?: string | null;
  readonly taskId: string;
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

/**
 * Modelo cognitivo do Core que chama os provedores pela politica do banco (ADR-017): planejar usa as rotas de
 * "analysis" e sintetizar usa as de "synthesis". Um objeto por tarefa, para o uso ir para a empresa certa.
 */
export class RoutedCognitiveModel extends LlmCognitiveModel {
  constructor(private readonly router: ProviderRouter, private readonly ctx: RoutedModelContext) { super(); }

  protected async complete(
    messages: readonly { role: "system" | "user"; content: string }[],
    maxTokens: number,
    purpose: "plan" | "synthesize",
  ): Promise<string> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    try {
      const out = await this.router.execute({
        tenantId: this.ctx.tenantId, unitId: this.ctx.unitId, taskId: this.ctx.taskId, attempt: this.ctx.attempt,
        taskType: purpose === "plan" ? "analysis" : "synthesis", request: { system, user, maxTokens }, signal: this.ctx.signal,
      });
      return out.text;
    } catch (e) {
      if (e instanceof ProviderBadRequestError) throw new CognitiveModelContractError();
      logEvent("warn", "core_routed_model_unavailable", { taskId: this.ctx.taskId, reason: e instanceof Error ? e.message : "unknown" });
      throw new CognitiveModelUnavailableError();
    }
  }
}
