import { CognitiveModelContractError, CognitiveModelUnavailableError, type CognitiveModel } from "@/domain/core/cognitive-model";
import type { CoreEvidence, CoreOperationalContext } from "@/domain/core/contracts";
import { logEvent } from "@/infrastructure/observability/logger";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function parseJsonObject(content: string): {
  metricIds?: unknown;
  capabilityIds?: unknown;
  productSlugs?: unknown;
} {
  const candidates = [content.trim()];
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(content.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as {
          metricIds?: unknown;
          capabilityIds?: unknown;
          productSlugs?: unknown;
        };
      }
    } catch {
      continue;
    }
  }
  throw new CognitiveModelContractError();
}

export class OpenAiCompatibleCognitiveModel implements CognitiveModel {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = 30_000,
  ) {
    if (!/^https?:\/\//.test(baseUrl) || !apiKey.trim() || !model.trim()) throw new CognitiveModelUnavailableError();
  }

  async plan(input: {
    question: string;
    metricCatalog: readonly { metricId: string; displayName: string; description: string }[];
    capabilityCatalog?: readonly { id: string; displayName: string; description: string }[];
    productCatalog?: readonly { slug: string; name: string }[];
    operationalContext: readonly CoreOperationalContext[];
  }): Promise<{
    metricIds: readonly string[];
    capabilityIds?: readonly string[];
    productSlugs?: readonly string[];
  }> {
    const content = await this.complete([
      { role: "system", content: [
        "Você é o planejador do FM Control Center, um Core cognitivo vertical de gestão empresarial.",
        "Selecione SOMENTE metricIds presentes no catálogo de métricas fornecido.",
        "Selecione SOMENTE capabilityIds presentes no catálogo de capabilities fornecido.",
        "Selecione SOMENTE productSlugs presentes no catálogo de produtos autorizado.",
        "Use productSlugs vazio quando a pergunta for global e não referir produto específico.",
        "Nunca use uma capability específica de produto para inferir um total global da empresa.",
        "Escolha até 8 métricas, até 4 capabilities e no máximo 4 produtos.",
        "Selecione ao menos uma métrica ou capability.",
        "Nunca invente produto, métrica, tenant, valor ou causa.",
        "Para correlação, anomalia, risco ou recomendação use múltiplas métricas quando necessário.",
        "O contexto operacional serve apenas para continuidade e não é fonte factual.",
        'Responda somente JSON no formato {"metricIds":["..."],"capabilityIds":["..."],"productSlugs":["..."]}.',
      ].join(" ") },
      { role: "user", content: JSON.stringify(input) },
    ], 512);

    try {
      const parsed = parseJsonObject(content);
      const rawMetricIds = parsed.metricIds ?? [];
      if (!Array.isArray(rawMetricIds)) throw new Error("invalid");
      const allowedMetrics = new Set(input.metricCatalog.map((item) => item.metricId));
      const metricIds = [...new Set(
        rawMetricIds.filter((item): item is string => typeof item === "string" && allowedMetrics.has(item)),
      )];
      if (metricIds.length > 8) throw new Error("invalid");

      const rawCapabilityIds = parsed.capabilityIds ?? [];
      if (!Array.isArray(rawCapabilityIds)) throw new Error("invalid");
      const allowedCapabilities = new Set(
        (input.capabilityCatalog ?? []).map((item) => item.id),
      );
      const capabilityIds = [...new Set(
        rawCapabilityIds.filter(
          (item): item is string =>
            typeof item === "string" && allowedCapabilities.has(item),
        ),
      )];
      if (capabilityIds.length > 4) throw new Error("invalid");
      if (metricIds.length === 0 && capabilityIds.length === 0) {
        throw new Error("invalid");
      }

      const rawProductSlugs = parsed.productSlugs ?? [];
      if (!Array.isArray(rawProductSlugs)) throw new Error("invalid");
      const productSlugs = [...new Set(rawProductSlugs.filter((item): item is string => typeof item === "string"))];
      if (productSlugs.length > 4) throw new Error("invalid");
      const allowedProducts = new Set((input.productCatalog ?? []).map((item) => item.slug));
      if (productSlugs.some((slug) => !allowedProducts.has(slug))) throw new CognitiveModelContractError();

      return capabilityIds.length > 0
        ? { metricIds, capabilityIds, productSlugs }
        : { metricIds, productSlugs };
    } catch (error) {
      if (error instanceof CognitiveModelContractError) throw error;
      throw new CognitiveModelContractError();
    }
  }

  async synthesize(input: {
    question: string;
    facts: readonly Record<string, unknown>[];
    evidence: readonly CoreEvidence[];
    operationalContext: readonly CoreOperationalContext[];
  }): Promise<string> {
    const content = await this.complete([
      { role: "system", content: [
        "Você é o FMCC Cognitive Vertical Core.",
        "Responda usando EXCLUSIVAMENTE facts/evidence governados.",
        "Pode explicar indicadores, correlacionar fatos, identificar padrões e anomalias, analisar riscos e recomendar próximos passos.",
        "Nunca invente números, produtos, causas ou fontes; nunca trate missing como zero; nunca some moedas sem política.",
        "Comparações entre produtos só podem usar fatos recebidos e evidências do escopo autorizado.",
        "Separe explicitamente fato, inferência, recomendação e previsão quando essas categorias aparecerem na resposta.",
        "Não declare causalidade a partir de correlação sem evidência causal explícita.",
        "Não declare anomalia, risco classificado ou previsão numérica sem sinal determinístico/contrato governado recebido nos facts.",
        "Quando a evidência for insuficiente, declare a insuficiência em vez de completar a lacuna.",
        "Contexto operacional é memória de continuidade, não fonte de verdade.",
      ].join(" ") },
      { role: "user", content: JSON.stringify(input) },
    ], 1024);

    if (!content.trim()) throw new CognitiveModelContractError();
    return content.trim();
  }

  private async complete(
    messages: readonly { role: "system" | "user"; content: string }[],
    maxTokens: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL("/v1/chat/completions", this.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model, temperature: 0, max_tokens: maxTokens,
          reasoning_effort: "low", stream: false, messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logEvent("warn", "cognitive_provider_http_error", {
          providerHost: new URL(this.baseUrl).hostname, model: this.model, status: response.status,
        });
        throw new CognitiveModelUnavailableError();
      }

      const payload = await response.json() as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new CognitiveModelContractError();
      return content;
    } catch (error) {
      if (error instanceof CognitiveModelContractError || error instanceof CognitiveModelUnavailableError) throw error;
      logEvent("warn", "cognitive_provider_transport_error", {
        providerHost: new URL(this.baseUrl).hostname, model: this.model,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      throw new CognitiveModelUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}
