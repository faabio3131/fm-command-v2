import { createHash } from "node:crypto";
import type { JsonHttpResponse, JsonHttpTransport } from "@/infrastructure/connectors/http-json-transport";
import { TransportError } from "@/infrastructure/connectors/http-json-transport";

/** Servidor de token OAuth simulado: código e refresh token de uso único, PKCE S256, Basic ou corpo. */
export class OAuthSimulator implements JsonHttpTransport {
  readonly clientId = "app-do-v2";
  readonly clientSecret = "segredo-do-app-do-v2";
  clientAuth: "basic" | "body" = "basic";
  lifetimeSeconds: number | undefined = 3600;
  rotatesRefreshToken = true;
  latencyMs = 0;
  queue: Array<"transport_error" | "http_503"> = [];
  readonly codes = new Map<string, { challenge?: string }>();
  readonly refreshTokens = new Set<string>();
  readonly requests: Array<{ url: string; form: Record<string, string>; headers: Record<string, string> }> = [];
  private seq = 0;
  now = () => Date.now();

  async post(): Promise<JsonHttpResponse> {
    throw new Error("n/a");
  }

  issueCode(code: string, challenge?: string) {
    this.codes.set(code, { challenge });
  }

  async get(): Promise<JsonHttpResponse> {
    throw new Error("n/a");
  }

  async postForm(
    url: string,
    form: Readonly<Record<string, string>>,
    options: { timeoutMs: number; headers?: Readonly<Record<string, string>> },
  ): Promise<JsonHttpResponse> {
    this.requests.push({ url, form: { ...form }, headers: { ...(options.headers ?? {}) } });
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const injected = this.queue.shift();
    if (injected === "transport_error") throw new TransportError();
    if (injected === "http_503") return { status: 503, body: undefined };

    const basic = options.headers?.authorization;
    const okBasic = basic === `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
    const okBody = form.client_id === this.clientId && form.client_secret === this.clientSecret;
    if (this.clientAuth === "basic" ? !okBasic : !okBody) return { status: 401, body: { error: "invalid_client" } };

    if (form.grant_type === "authorization_code") {
      const entry = this.codes.get(form.code);
      if (!entry) return { status: 400, body: { error: "invalid_grant" } };
      this.codes.delete(form.code); // uso único
      if (entry.challenge) {
        const expected = createHash("sha256").update(form.code_verifier ?? "").digest("base64url");
        if (expected !== entry.challenge) return { status: 400, body: { error: "invalid_grant" } };
      }
      return { status: 200, body: this.tokens() };
    }
    if (form.grant_type === "refresh_token") {
      if (!this.refreshTokens.has(form.refresh_token)) return { status: 400, body: { error: "invalid_grant" } };
      if (this.rotatesRefreshToken) this.refreshTokens.delete(form.refresh_token); // uso único
      return { status: 200, body: this.tokens(!this.rotatesRefreshToken ? false : true) };
    }
    return { status: 400, body: { error: "unsupported_grant_type" } };
  }

  private tokens(withRefresh = true) {
    this.seq += 1;
    const body: Record<string, unknown> = { access_token: `access-${this.seq}` };
    if (this.lifetimeSeconds !== undefined) body.expires_in = this.lifetimeSeconds;
    if (withRefresh) {
      const refresh = `refresh-${this.seq}`;
      this.refreshTokens.add(refresh);
      body.refresh_token = refresh;
    }
    return body;
  }
}
