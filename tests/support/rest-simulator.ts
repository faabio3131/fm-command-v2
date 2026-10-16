import type { JsonHttpResponse, JsonHttpTransport } from "@/infrastructure/connectors/http-json-transport";
import { TransportError } from "@/infrastructure/connectors/http-json-transport";

/** ERP REST sintético: receivables por página (total_pages), payables por offset. Dados por conta. */
export class RestSimulator implements JsonHttpTransport {
  readonly requests: Array<{ url: string; headers: Record<string, string> }> = [];
  readonly accounts = new Map<string, { receivables: Record<string, unknown>[]; payables: Record<string, unknown>[] }>();
  validAuth: (headers: Record<string, string>) => boolean = (h) => h["x-api-key"] === "chave-valida";
  queue: Array<"transport_error" | "http_503" | "http_429" | "http_401" | "bad_shape"> = [];
  active = 0;
  maxActive = 0;
  latencyMs = 0;

  async post(): Promise<JsonHttpResponse> { throw new Error("n/a"); }
  async postForm(): Promise<JsonHttpResponse> { throw new Error("n/a"); }

  async get(url: string, options: { timeoutMs: number; headers?: Readonly<Record<string, string>> }): Promise<JsonHttpResponse> {
    const headers = { ...(options.headers ?? {}) };
    this.requests.push({ url, headers });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
      const injected = this.queue.shift();
      if (injected === "transport_error") throw new TransportError();
      if (injected === "http_503") return { status: 503, body: undefined };
      if (injected === "http_429") return { status: 429, body: undefined };
      if (injected === "http_401") return { status: 401, body: undefined };
      if (injected === "bad_shape") return { status: 200, body: { unexpected: true } };
      if (!this.validAuth(headers)) return { status: 401, body: undefined };

      const u = new URL(url);
      const m = /^\/v1\/accounts\/([^/]+)\/(receivables|payables|ping)$/.exec(u.pathname);
      if (!m) return { status: 404, body: undefined };
      const account = this.accounts.get(decodeURIComponent(m[1]));
      if (!account) return { status: 404, body: undefined };
      if (m[2] === "ping") return { status: 200, body: { ok: true } };
      let rows = m[2] === "receivables" ? account.receivables : account.payables;
      const since = u.searchParams.get("updated_since");
      if (since) rows = rows.filter((r) => String(r.updated_at ?? "9999") >= since.slice(0, 10));
      if (m[2] === "receivables") {
        const page = Number(u.searchParams.get("page") ?? 1);
        const size = Number(u.searchParams.get("size") ?? 100);
        return { status: 200, body: { data: rows.slice((page - 1) * size, page * size), meta: { total_pages: Math.max(1, Math.ceil(rows.length / size)) } } };
      }
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const limit = Number(u.searchParams.get("limit") ?? 100);
      return { status: 200, body: { items: rows.slice(offset, offset + limit) } };
    } finally {
      this.active -= 1;
    }
  }
}

export const syntheticDefinition = {
  id: "erp_sintetico",
  version: 1,
  label: "ERP sintético",
  regions: ["BR"],
  status: "ready",
  auth: { type: "api_key", header: "x-api-key" },
  baseUrl: "https://api.erp-sintetico.test",
  limits: { requestsPerMinute: 120, maxConcurrent: 3 },
  variables: ["accountId"],
  health: { path: "/v1/accounts/{accountId}/ping" },
  streams: [
    {
      name: "receivables", factType: "finance.receivable", path: "/v1/accounts/{accountId}/receivables",
      pagination: { style: "page", pageParam: "page", sizeParam: "size", size: 2, totalPagesPath: "meta.total_pages" },
      recordsPath: "data",
      incremental: { param: "updated_since", format: "iso_date" },
      fields: {
        externalId: { path: "id" },
        amount: { path: "amount", type: "decimal" },
        dueDate: { path: "due", type: "date", dateFormat: "iso" },
        issueDate: { path: "issued", type: "date", dateFormat: "dd/mm/yyyy" },
        counterpartyRef: { path: "customer.id" },
        changedAt: { path: "updated_at_ts", type: "datetime" },
        unitRef: { path: "branch" },
        status: { path: "state", map: { PAID: "settled", OPEN: "open", LATE: "overdue", VOID: "cancelled" } },
      },
    },
    {
      name: "payables", factType: "finance.payable", path: "/v1/accounts/{accountId}/payables",
      pagination: { style: "offset", offsetParam: "offset", sizeParam: "limit", size: 2 },
      recordsPath: "items",
      fields: { externalId: { path: "id" }, amount: { path: "amount_minor", type: "minor" } },
    },
  ],
} as const;

export const rec = (id: number, over: Record<string, unknown> = {}) => ({
  id, amount: "10.50", due: "2026-11-20", issued: "01/10/2026", customer: { id: 7 }, state: "OPEN",
  updated_at: "2026-10-05", updated_at_ts: "2026-10-05T10:00:00Z", ...over,
});
