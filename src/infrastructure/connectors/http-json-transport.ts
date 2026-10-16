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
  /** application/x-www-form-urlencoded (pedido de token OAuth). */
  postForm(
    url: string,
    form: Readonly<Record<string, string>>,
    options: { timeoutMs: number; headers?: Readonly<Record<string, string>> },
  ): Promise<JsonHttpResponse>;
}

const MAX_RESPONSE_CHARS = 5_000_000;

async function send(
  url: string,
  init: { headers: Record<string, string>; body: string },
  timeoutMs: number,
): Promise<JsonHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", ...init.headers },
      body: init.body,
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

export class FetchJsonTransport implements JsonHttpTransport {
  post(url: string, body: unknown, options: { timeoutMs: number }) {
    return send(url, { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, options.timeoutMs);
  }

  postForm(
    url: string,
    form: Readonly<Record<string, string>>,
    options: { timeoutMs: number; headers?: Readonly<Record<string, string>> },
  ) {
    return send(
      url,
      {
        headers: { "content-type": "application/x-www-form-urlencoded", ...(options.headers ?? {}) },
        body: new URLSearchParams(form).toString(),
      },
      options.timeoutMs,
    );
  }
}
