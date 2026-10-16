import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/application/integration/rate-limiter";
import { buildAuthorizeUrl } from "@/application/integration/oauth-client";
import type { SourceDefinition } from "@/domain/integration/contracts";
import { connectorCatalog, declarativeDefinitions } from "@/infrastructure/connectors/catalog";
import { DeclarativeRestConnector } from "@/infrastructure/connectors/declarative/declarative-connector";
import type { JsonHttpResponse, JsonHttpTransport } from "@/infrastructure/connectors/http-json-transport";
import { oauthProvider } from "@/infrastructure/connectors/oauth-providers";
import { InMemoryCredentialStore } from "./support/omie-simulator";

/** Imita o formato documentado do Bling API v3: `data`, `pagina`/`limite`, sem total de registros. */
class BlingSimulator implements JsonHttpTransport {
  readonly requests: URL[] = [];
  authorization: string[] = [];
  receivables: Record<string, unknown>[] = [];
  payables: Record<string, unknown>[] = [];
  async post(): Promise<JsonHttpResponse> { throw new Error("n/a"); }
  async postForm(): Promise<JsonHttpResponse> { throw new Error("n/a"); }
  async get(url: string, options: { headers?: Readonly<Record<string, string>> }): Promise<JsonHttpResponse> {
    const u = new URL(url);
    this.requests.push(u);
    this.authorization.push(options.headers?.authorization ?? options.headers?.Authorization ?? "");
    if (u.pathname === "/Api/v3/contas-contabeis") return { status: 200, body: { data: [] } };
    const rows = u.pathname === "/Api/v3/contas/receber" ? this.receivables : u.pathname === "/Api/v3/contas/pagar" ? this.payables : undefined;
    if (!rows) return { status: 404, body: undefined };
    const page = Number(u.searchParams.get("pagina") ?? "1");
    const limit = Number(u.searchParams.get("limite") ?? "100");
    return { status: 200, body: { data: rows.slice((page - 1) * limit, page * limit) } };
  }
}

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: 1000 + n, situacao: 1, vencimento: "2026-11-10", dataEmissao: "2026-10-01", valor: 1500.75, contato: { id: 77 + n }, ...extra,
});

function build(rest: BlingSimulator) {
  const def = declarativeDefinitions().find((d) => d.id === "bling");
  if (!def) throw new Error("definição ausente");
  const connector = new DeclarativeRestConnector(def, {
    transport: rest,
    limiter: new RateLimiter(),
    credentials: new InMemoryCredentialStore(),
    tokens: { accessToken: async () => "tok-b" },
    oauthProvider: () => oauthProvider("bling"),
    oauthClient: () => ({ clientId: "id", clientSecret: "segredo" }),
    clock: { now: () => Date.parse("2026-10-16T12:00:00Z"), sleep: async () => undefined },
  });
  const source: SourceDefinition = {
    id: "s", tenantId: "empresa-a", name: "Bling", sourceType: "bling", authoritativeDomain: "finance",
    status: "configured", syncMode: "pull", mappingVersion: "bling-v1", secretRef: "vault:b", config: { currency: "BRL" },
  };
  return { connector, source, context: { tenantId: "empresa-a", correlationId: "c", timeoutMs: 4000 } };
}

describe("8E Bling: definição conferida na documentação oficial", () => {
  it("está pronta, respeita 3 requisições por segundo e o intervalo de data fica abaixo de 1 ano", () => {
    const entry = connectorCatalog().find((e) => e.id === "bling");
    expect(entry).toMatchObject({ status: "ready", authType: "oauth2", variables: [] });
    expect(entry?.limits.requestsPerMinute).toBeLessThanOrEqual(180);
    const def = declarativeDefinitions().find((d) => d.id === "bling");
    for (const s of def?.streams ?? []) {
      expect((s.window?.pastDays ?? 0) + (s.window?.futureDays ?? 0)).toBeLessThanOrEqual(364);
    }
  });

  it("filtra por vencimento, usa Bearer, pagina até a página curta e depois segue para contas a pagar", async () => {
    const rest = new BlingSimulator();
    rest.receivables = Array.from({ length: 130 }, (_, i) => row(i));
    rest.payables = [{ id: 5, situacao: 2, vencimento: "2026-10-20", valor: 99.9, contato: { id: 9 } }];
    const { connector, source, context } = build(rest);

    const first = await connector.pull(context, source);
    expect(first.facts).toHaveLength(100);
    const req = rest.requests[0];
    expect(req.pathname).toBe("/Api/v3/contas/receber");
    expect(req.searchParams.get("tipoFiltroData")).toBe("V");
    expect(req.searchParams.get("dataInicial")).toBe("2026-01-19");
    expect(req.searchParams.get("dataFinal")).toBe("2027-01-14");
    expect(req.searchParams.get("limite")).toBe("100");
    expect(rest.authorization[0]).toBe("Bearer tok-b");
    expect(first.facts[0].payload).toMatchObject({ amountMinor: 150075, dueDate: "2026-11-10", issueDate: "2026-10-01", status: "open", counterpartyRef: "77" });

    const second = await connector.pull(context, source, first.nextCursor);
    expect(second.facts).toHaveLength(30);
    expect(JSON.parse(second.nextCursor ?? "{}").s).toBe("payables");

    const pay = await connector.pull(context, source, second.nextCursor);
    expect(rest.requests.at(-1)?.searchParams.get("dataVencimentoInicial")).toBe("2026-01-19");
    expect(pay.facts[0]).toMatchObject({ factType: "finance.payable", externalId: "payables:5" });
    expect(pay.facts[0].payload).toMatchObject({ amountMinor: 9990, status: "settled" });
  });

  it("situação sem equivalente seguro (parcial, devolvido parcial, confirmado) fica indisponível, nunca chutada", async () => {
    const rest = new BlingSimulator();
    rest.receivables = [row(1, { situacao: 6 }), row(2, { situacao: 7 }), row(3, { situacao: 5 }), row(4, { situacao: 3 })];
    const { connector, source, context } = build(rest);
    const { facts } = await connector.pull(context, source);
    expect(facts[0].payload.unavailable).toContain("status");
    expect(facts[0].payload.sourceStatus).toBe("6");
    expect(facts[1].payload.unavailable).toContain("status");
    expect(facts[2].payload.status).toBe("cancelled");
    expect(facts[3].payload.unavailable).toContain("status");
  });

  it("a URL de autorização e o token seguem a documentação (sem PKCE, Basic)", () => {
    const provider = oauthProvider("bling");
    const url = buildAuthorizeUrl(provider, { clientId: "meu-id", clientSecret: "x" }, { redirectUri: "https://app.exemplo.com/api/oauth/callback", state: "est" });
    expect(url.startsWith("https://www.bling.com.br/Api/v3/oauth/authorize?")).toBe(true);
    expect(url).toContain("response_type=code");
    expect(url).not.toContain("code_challenge");
    expect(provider.tokenUrl).toBe("https://api.bling.com.br/Api/v3/oauth/token");
    expect(provider.clientAuth).toBe("basic");
  });
});
