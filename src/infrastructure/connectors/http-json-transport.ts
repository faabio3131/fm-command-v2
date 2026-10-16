/**
 * Transporte HTTP/JSON dos conectores. Existe como porta para que os testes
 * usem um simulador em memória e para que nenhum conector abra rede por conta
 * própria. A implementação real não segue redirecionamentos e limita o
 * tamanho da resposta.
 */
export interface JsonHttpResponse {
  readonly status: number;
  /** Corpo já interpretado; `undefined` quando não era JSON. */
  readonly body: unknown;
}

export class TransportError extends Error {
  constructor() {
    super("integration.transport_error");
    this.name = "TransportError";
  }
}

export interface JsonHttpTransport {
  post(
    url: string,
    body: unknown,
    options: { timeoutMs: number },
  ): Promise<JsonHttpResponse>;
}

const MAX_RESPONSE_CHARS = 5_000_000;

export class FetchJsonTransport implements JsonHttpTransport {
  async post(
    url: string,
    body: unknown,
    options: { timeoutMs: number },
  ): Promise<JsonHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARS) throw new TransportError();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      return { status: response.status, body: parsed };
    } catch {
      // Nunca repassar a causa original: ela pode carregar a URL ou o corpo com credencial.
      throw new TransportError();
    } finally {
      clearTimeout(timer);
    }
  }
}
