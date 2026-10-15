import { describe, expect, it } from "vitest";
import type {
  ConnectorContext,
  SourceDefinition,
} from "@/domain/integration/contracts";
import {
  KORDENA_COMMERCIAL_SECRET_REF,
} from "@/infrastructure/integration/kordena-commercial-connector";
import {
  KordenaPlatformIntegrationConnector,
} from "@/infrastructure/integration/kordena-platform-integration-connector";

const source: SourceDefinition = {
  id: "source-kordena",
  tenantId: "tenant-fmcc",
  productId: "product-kordena",
  name: "Kordena Commercial",
  sourceType: "kordena-commercial-v1",
  authoritativeDomain: "commercial",
  status: "healthy",
  syncMode: "pull",
  secretRef: KORDENA_COMMERCIAL_SECRET_REF,
  config: { baseUrl: "https://kordena.example.test" },
  mappingVersion: "kordena-commercial-v1",
};

const context: ConnectorContext = {
  tenantId: "tenant-fmcc",
  correlationId: "corr-platform-integrations",
  timeoutMs: 25_000,
};

function connector(
  fetcher: typeof fetch,
): KordenaPlatformIntegrationConnector {
  return new KordenaPlatformIntegrationConnector(
    () => "service-token-".padEnd(40, "x"),
    fetcher,
    () => ["https://kordena.example.test"],
    () => "tenant-fmcc",
  );
}

describe("Command platform integration control plane", () => {
  it("lists platform-managed integrations using only the S2S token", async () => {
    let authorization = "";
    let path = "";
    const runtime = connector(async (input, init) => {
      path = new URL(String(input)).pathname;
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(
        JSON.stringify({
          integracoes: [
            {
              catalogo: {
                servico: "ia.generativa",
                provedor: "openai",
                label: "OpenAI · GPT-5.6 Luna",
                parametros_obrigatorios: ["model"],
                credenciais_obrigatorias: ["api_key"],
                healthcheck_supported: true,
                escopo_gestao: "platform_managed",
              },
              configuracao: null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await runtime.overview(context, source);

    expect(path).toBe("/v1/control-plane/fmcc/integrations");
    expect(authorization).toBe(
      `Bearer ${"service-token-".padEnd(40, "x")}`,
    );
    expect(result.integracoes[0].catalogo.provedor).toBe("openai");
  });

  it("forwards the OpenAI key transiently without confusing it with the S2S token", async () => {
    let body = "";
    let authorization = "";
    const runtime = connector(async (_input, init) => {
      body = String(init?.body ?? "");
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(
        JSON.stringify({
          configuracao_id: "ia.generativa--openai",
          servico: "ia.generativa",
          provedor: "openai",
          conta_externa: "principal",
          ambiente: "homologacao",
          parametros: { model: "gpt-5.6-luna" },
          credenciais_estado: { api_key: true },
          habilitada: true,
          homologada: false,
          evidencia_homologacao_ref: null,
          versao: 1,
          prontidao: {
            estado: "configurado",
            pronto: false,
            faltam_parametros: [],
            faltam_finalidades: [],
            faltam_credenciais: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const saved = await runtime.configure(context, source, {
      configId: "ia.generativa--openai",
      actor: {
        user_id: "owner-1",
        role: "owner",
        step_up_at: "2026-10-06T18:00:00Z",
      },
      configuracao: {
        servico: "ia.generativa",
        provedor: "openai",
        conta_externa: "principal",
        ambiente: "homologacao",
        parametros: [{ nome: "model", valor: "gpt-5.6-luna" }],
        credenciais: [{ papel: "api_key", valor: "sk-openai-real-test" }],
        habilitada: true,
        versao: 0,
      },
    });

    expect(authorization).toBe(
      `Bearer ${"service-token-".padEnd(40, "x")}`,
    );
    expect(body).toContain("sk-openai-real-test");
    expect(body).not.toContain("service-token-xxxxxxxx");
    expect(saved.credenciais_estado.api_key).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("sk-openai-real-test");
  });

  it("runs healthcheck and forwards only sanitized evidence to homologation", async () => {
    const paths: string[] = [];
    const bodies: string[] = [];
    const runtime = connector(async (input, init) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      bodies.push(String(init?.body ?? ""));
      if (path.endsWith("/healthcheck")) {
        return new Response(
          JSON.stringify({
            executado: true,
            suportado: true,
            provedor: "openai",
            evidencia_ref:
              "healthcheck://openai/20261006T180000Z/gpt-5.6-luna/abc123",
            detalhes: { model: "gpt-5.6-luna" },
            erro: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          configuracao_id: "ia.generativa--openai",
          servico: "ia.generativa",
          provedor: "openai",
          conta_externa: "principal",
          ambiente: "homologacao",
          parametros: { model: "gpt-5.6-luna" },
          credenciais_estado: { api_key: true },
          habilitada: true,
          homologada: true,
          evidencia_homologacao_ref:
            "healthcheck://openai/20261006T180000Z/gpt-5.6-luna/abc123",
          versao: 2,
          prontidao: {
            estado: "pronto",
            pronto: true,
            faltam_parametros: [],
            faltam_finalidades: [],
            faltam_credenciais: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const actor = {
      user_id: "owner-1",
      role: "owner" as const,
      step_up_at: "2026-10-06T18:00:00Z",
    };

    const health = await runtime.healthcheck(context, source, {
      configId: "ia.generativa--openai",
      actor,
    });
    expect(health.executado).toBe(true);

    await runtime.homologate(context, source, {
      configId: "ia.generativa--openai",
      actor,
      evidenceRef: String(health.evidencia_ref),
    });

    expect(paths).toEqual([
      "/v1/control-plane/fmcc/integrations/ia.generativa--openai/healthcheck",
      "/v1/control-plane/fmcc/integrations/ia.generativa--openai/homologar",
    ]);
    expect(bodies[1]).toContain("healthcheck://openai/");
    expect(bodies[1]).not.toContain("api_key");
  });

  it("fails closed before network access outside the Command tenant or allowlist", async () => {
    let reached = false;
    const runtime = connector(async () => {
      reached = true;
      throw new Error("network should not be reached");
    });

    await expect(
      runtime.overview({ ...context, tenantId: "other-tenant" }, source),
    ).rejects.toThrow();
    expect(reached).toBe(false);

    await expect(
      runtime.overview(context, {
        ...source,
        config: { baseUrl: "https://attacker.example.test" },
      }),
    ).rejects.toThrow("integration.kordena_origin_not_allowed");
    expect(reached).toBe(false);
  });
});
