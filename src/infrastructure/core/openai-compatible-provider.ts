import {
  MAX_TOKENS_IN, MAX_TOKENS_OUT, ProviderBadRequestError, ProviderRejectedError, ProviderTransientError, validateProviderConfig,
  type AiProvider, type ProviderConfig, type ProviderRequest, type ProviderResult,
} from "@/domain/core/ai-provider";

interface ChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/** Raiz do servidor -> /v1/chat/completions; base com caminho (ex.: .../openai/v1) -> acrescenta /chat/completions. */
function endpoint(baseUrl: string): URL {
  const u = new URL(baseUrl);
  const path = u.pathname.replace(/\/+$/, "");
  u.pathname = path === "" ? "/v1/chat/completions" : `${path}/chat/completions`;
  u.search = ""; u.hash = "";
  return u;
}

const count = (v: unknown): number | null => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

/**
 * Adaptador para qualquer API compatível com /v1/chat/completions. A chave vem de uma variável de
 * ambiente indicada por `secretRef` e nunca aparece em log, erro ou banco.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly id: string;
  constructor(
    private readonly config: ProviderConfig,
    private readonly env: Readonly<Record<string, string | undefined>> = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const errors = validateProviderConfig(config, { allowLocal: env.FMCC_AI_ALLOW_LOCAL_PROVIDERS === "1" });
    if (errors.length > 0) throw new Error(`ai.provider_config_invalid:${errors.join(",")}`);
    this.id = config.id;
  }

  async invoke(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResult> {
    const key = this.env[this.config.secretRef.slice("env://".length)]?.trim();
    if (!key) throw new ProviderRejectedError("ai.provider_secret_missing");
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const both = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint(this.config.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: this.config.model, temperature: 0, max_tokens: request.maxTokens, stream: false,
          messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
        }),
        signal: both,
        redirect: "error", // um redirecionamento poderia levar a chave para outro endereco
      });
    } catch {
      throw new ProviderTransientError(timeout.aborted ? "ai.provider_timeout" : signal.aborted ? "ai.provider_aborted" : "ai.provider_network_error");
    }
    const s = response.status;
    if (s === 429 || s === 408 || s >= 500) { await response.body?.cancel().catch(() => undefined); throw new ProviderTransientError(`ai.provider_http_${s}`); }
    if (s === 400 || s === 413 || s === 422) { await response.body?.cancel().catch(() => undefined); throw new ProviderBadRequestError(`ai.provider_http_${s}`); }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new ProviderRejectedError(`ai.provider_http_${s}`); }
    let payload: ChatResponse;
    try { payload = await response.json() as ChatResponse; }
    catch { throw new ProviderRejectedError("ai.provider_response_not_json"); }
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new ProviderRejectedError("ai.provider_response_empty");
    const tin = count(payload.usage?.prompt_tokens);
    const tout = count(payload.usage?.completion_tokens);
    if ((tin !== null && tin > MAX_TOKENS_IN) || (tout !== null && tout > MAX_TOKENS_OUT)) throw new ProviderRejectedError("ai.provider_usage_out_of_range");
    const estimated = tin === null || tout === null;
    return {
      text,
      tokensIn: tin ?? Math.ceil((request.system.length + request.user.length) / 4),
      tokensOut: tout ?? Math.ceil(text.length / 4),
      model: typeof payload.model === "string" && payload.model ? payload.model : this.config.model,
      estimated,
    };
  }
}
