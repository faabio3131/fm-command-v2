import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/application/integration/rate-limiter";
import { buildAuthorizeUrl } from "@/application/integration/oauth-client";
import type { SourceDefinition } from "@/domain/integration/contracts";
import { connectorCatalog, declarativeDefinitions } from "@/infrastructure/connectors/catalog";
import { DeclarativeRestConnector } from "@/infrastructure/connectors/declarative/declarative-connector";
import type { JsonHttpResponse, JsonHttpTransport } from "@/infrastructure/connectors/http-json-transport";
import { oauthProvider } from "@/infrastructure/connectors/oauth-providers";
import { InMemoryCredentialStore } from "./support/omie-simulator";

/** Imita o formato documentado da Conta Azul (contas a receber/pagar): intervalo de vencimento obrigatório e `itens_totais`. */
class ContaAzulSimulator implements JsonHttpTransport {
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
    if (u.pathname === "/v1/financeiro/categorias") return { status: 200, body: { itens: [] } };
    const rows = u.pathname === "/v1/financeiro/contas-a-receber" ? this.receivables : u.pathname === "/v1/financeiro/contas-a-pagar" ? this.payables : undefined;
    if (!rows) return { status: 404, body: undefined };
    if (!u.searchParams.get("data_vencimento_de") || !u.searchParams.get("data_vencimento_ate")) return { status: 400, body: undefined };
    const page = Number(u.searchParams.get("pagina") ?? "1");
    const size = Number(u.searchParams.get("tamanho_pagina") ?? "10");
    return { status: 200, body: { itens: rows.slice((page - 1) * size, page * size), itens_totais: rows.length } };
  }
}

const item = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `p-${n}`, total: 150.5, data_vencimento: "2026-11-10", status_traduzido: "EM_ABERTO", cliente: { id: `c-${n}` }, ...extra,
});

function build(rest: ContaAzulSimulator) {
  const def = declarativeDefinitions().find((d) => d.id === "conta_azul");
  if (!def) throw new Error("definição ausente");
  const store = new InMemoryCredentialStore();
  const connector = new DeclarativeRestConnector(def, {
    transport: rest,
    limiter: new RateLimiter(),
    credentials: store,
    tokens: { accessToken: async () => "tok-1" },
    oauthProvider: () => oauthProvider("conta_azul"),
    oauthClient: () => ({ clientId: "id", clientSecret: "segredo" }),
    clock: { now: () => Date.parse("2026-10-16T12:00:00Z"), sleep: async () => undefined },
  });
  const source: SourceDefinition = {
    id: "s", tenantId: "empresa-a", name: "CA", sourceType: "conta_azul", authoritativeDomain: "finance",
    status: "configured", syncMode: "pull", mappingVersion: "conta_azul-v1", secretRef: "vault:a", config: { currency: "BRL" },
  };
  return { connector, source, context: { tenantId: "empresa-a", correlationId: "c", timeoutMs: 4000 } };
}

describe("8E Conta Azul: definição conferida na documentação oficial", () => {
  it("está pronta no catálogo, sem variáveis por empresa, com o limite oficial respeitado", () => {
    const entry = connectorCatalog().find((e) => e.id === "conta_azul");
    expect(entry).toMatchObject({ status: "ready", authType: "oauth2", variables: [] });
    expect(entry?.limits.requestsPerMinute).toBeLessThanOrEqual(600);
  });

  it("envia Bearer, o intervalo de vencimento obrigatório e pagina pelo total de itens", async () => {
    const rest = new ContaAzulSimulator();
    rest.receivables = Array.from({ length: 230 }, (_, i) => item(i));
    rest.payables = [{ id: "d-1", total: "99.90", data_vencimento: "2026-10-20", status_traduzido: "ATRASADO", fornecedor: { id: "f-1" } }];
    const { connector, source, context } = build(rest);

    const first = await connector.pull(context, source);
    expect(first.facts).toHaveLength(100);
    const req = rest.requests[0];
    expect(req.searchParams.get("pagina")).toBe("1");
    expect(req.searchParams.get("tamanho_pagina")).toBe("100");
    expect(req.searchParams.get("data_vencimento_de")).toBe("2026-04-19");
    expect(req.searchParams.get("data_vencimento_ate")).toBe("2027-04-14");
    expect(rest.authorization[0]).toBe("Bearer tok-1");
    expect(first.facts[0]).toMatchObject({ factType: "finance.receivable", externalId: "receivables:p-0" });
    expect(first.facts[0].payload).toMatchObject({ amountMinor: 15050, dueDate: "2026-11-10", status: "open", counterpartyRef: "c-0", currency: "BRL" });

    const second = await connector.pull(context, source, first.nextCursor);
    const third = await connector.pull(context, source, second.nextCursor);
    expect(second.facts).toHaveLength(100);
    expect(third.facts).toHaveLength(30);
    expect(JSON.parse(third.nextCursor ?? "{}").s).toBe("payables");

    const pay = await connector.pull(context, source, third.nextCursor);
    expect(pay.facts[0]).toMatchObject({ factType: "finance.payable", externalId: "payables:d-1" });
    expect(pay.facts[0].payload).toMatchObject({ amountMinor: 9990, status: "overdue", counterpartyRef: "f-1" });
  });

  it("valor, vencimento ou status ausentes viram indisponíveis, nunca zero", async () => {
    const rest = new ContaAzulSimulator();
    rest.receivables = [{ id: "x-1", total: null, data_vencimento: null, status_traduzido: "NAO_MAPEADO" }];
    const { connector, source, context } = build(rest);
    const { facts } = await connector.pull(context, source);
    expect(facts[0].payload.amountMinor).toBeUndefined();
    expect(facts[0].payload.unavailable).toEqual(expect.arrayContaining(["amountMinor", "dueDate", "status", "counterpartyRef"]));
  });

  it("saúde usa um endereço sem parâmetros obrigatórios", async () => {
    const rest = new ContaAzulSimulator();
    const { connector, source, context } = build(rest);
    await expect(connector.health(context, source)).resolves.toBe("healthy");
  });

  it("a URL de autorização coloca os parâmetros depois do # e usa o login oficial", () => {
    const url = buildAuthorizeUrl(oauthProvider("conta_azul"), { clientId: "meu-id", clientSecret: "x" }, { redirectUri: "https://app.exemplo.com/api/oauth/callback", state: "est" });
    expect(url.startsWith("https://login.contaazul.com/#/oauth/authorize?response_type=code&client_id=meu-id")).toBe(true);
    expect(url).toContain("scope=openid+profile+aws.cognito.signin.user.admin");
    expect(url).toContain("state=est");
    expect(url).not.toContain("code_challenge");
    expect(oauthProvider("conta_azul").tokenUrl).toBe("https://api-v2.contaazul.com/oauth/token");
  });
});
