import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("CME-09 source/provider governance", () => {
  it("não promove Kordena para CONNECTED antes do CME-10", () => {
    const register = source(
      "docs/governance/CME-09-source-provider-coverage-register.md",
    );

    expect(register).toContain("KORDENA_CONNECTOR_CODE = READY_TO_CONNECT");
    expect(register).toContain("KORDENA_RUNTIME = DEFER_TO_CME_10");
    expect(register).toContain("FALSE_CONNECTED_CLAIMS = 0");
    expect(register).toContain("PROVIDER_UNDECIDED");
  });

  it("expõe health persistido e último sync na Central de Fontes", () => {
    const page = source("src/app/dashboard/sources/page.tsx");
    const panel = source(
      "src/app/dashboard/sources/source-control-panel.tsx",
    );
    const repositories = source(
      "src/infrastructure/integration/postgres-repositories.ts",
    );

    expect(page).toContain("operationalState");
    expect(panel).toContain("Último sync bem-sucedido");
    expect(panel).toContain("Saúde persistida");
    expect(repositories).toContain("updateStatus");
    expect(repositories).toContain("lastSuccessfulAt");
  });

  it("audita cadastro, health e sync sem logar segredo bruto", () => {
    const createRoute = source("src/app/api/sources/route.ts");
    const healthRoute = source(
      "src/app/api/sources/[sourceId]/health/route.ts",
    );
    const syncRoute = source(
      "src/app/api/sources/[sourceId]/sync/route.ts",
    );

    expect(createRoute).toContain("integration.source.registered");
    expect(healthRoute).toContain("integration.health.checked");
    expect(syncRoute).toContain("integration.sync.executed");
    expect(createRoute).not.toContain("secretRef: source.secretRef");
  });

  it("classifica 429 e 5xx do Kordena como retryable", () => {
    const connector = source(
      "src/infrastructure/integration/kordena-commercial-connector.ts",
    );
    const runtime = source(
      "src/application/integration/connector-runtime.ts",
    );

    expect(connector).toContain("response.status === 429");
    expect(connector).toContain("response.status >= 500");
    expect(connector).toContain("RetryableConnectorError");
    expect(runtime).toContain("error instanceof RetryableConnectorError");
  });

  it("registra os dez domínios obrigatórios do CME-09", () => {
    const register = source(
      "docs/governance/CME-09-source-provider-coverage-register.md",
    );

    for (const domain of [
      "Billing / invoices",
      "Pagamentos",
      "Subscriptions / trials",
      "Inadimplência",
      "Custos de infraestrutura / FinOps",
      "Custos operacionais",
      "CRM / leads",
      "Telemetria de produto",
      "Incidentes / erros",
      "Suporte",
    ]) {
      expect(register).toContain(domain);
    }
  });
});
