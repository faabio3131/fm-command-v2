import { describe, expect, it } from "vitest";
import { ConnectorRuntime, RetryableConnectorError } from "@/application/integration/connector-runtime";
import type { Connector, SourceDefinition, SourceRepository } from "@/domain/integration/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = { tenantId: "tenant-a", userId: "u1", role: "owner", correlationId: "corr-1" };
const source: SourceDefinition = {
  id: "source-1", tenantId: "tenant-a", name: "fixture", sourceType: "fixture",
  authoritativeDomain: "billing", status: "configured", syncMode: "pull", config: {}, mappingVersion: "v1", secretRef: "render:fixture",
};

function sourceRepo(sourceResult: SourceDefinition | null): SourceRepository {
  return {
    async findById() { return sourceResult; },
    async list() { return sourceResult ? [sourceResult] : []; },
    async create(tenantId, input) {
      return {
        id: "created", tenantId, name: input.name, sourceType: input.sourceType,
        authoritativeDomain: input.authoritativeDomain, status: "configured" as const, syncMode: input.syncMode,
        secretRef: input.secretRef, config: input.config ?? {}, freshnessSeconds: input.freshnessSeconds, mappingVersion: input.mappingVersion ?? "v1",
      };
    },
  };
}

function runtimeFor(sourceResult: SourceDefinition | null = source, connectorOverride?: Connector) {
  const completed = new Map<string, string>();
  const facts: unknown[] = [];
  const failures: Array<{ errorCode: string; errorMessage: string }> = [];
  const connector: Connector = connectorOverride ?? {
    sourceType: "fixture", capabilities: ["billing.read"],
    async health() { return "healthy"; },
    async pull() { return { facts: [{ externalId: "invoice-1", factType: "billing.invoice", payload: { amount: 10 }, sourceTimestamp: new Date("2026-09-20T00:00:00Z") }], nextCursor: "next" }; },
  };
  const runtime = new ConnectorRuntime(
    sourceRepo(sourceResult),
    {
      async begin(input) {
        const id = completed.get(input.idempotencyKey);
        return id ? { id, state: "completed" as const } : { id: "exec-1", state: "started" as const };
      },
      async complete(input) { completed.set("idem-1", input.id); },
      async fail(input) { failures.push({ errorCode: input.errorCode, errorMessage: input.errorMessage }); },
    },
    { async ingest(input) { facts.push(input); } },
    [connector],
    100,
    3,
    0,
  );
  return { runtime, facts, failures };
}

describe("F07 integration fabric", () => {
  it("ingere facts com provenance e respeita idempotência", async () => {
    const { runtime, facts } = runtimeFor();
    const first = await runtime.syncPull(context, { sourceId: "source-1", idempotencyKey: "idem-1" });
    const duplicate = await runtime.syncPull(context, { sourceId: "source-1", idempotencyKey: "idem-1" });
    expect(first).toMatchObject({ status: "completed", ingested: 1, nextCursor: "next" });
    expect(duplicate).toMatchObject({ status: "duplicate", ingested: 0 });
    expect(facts).toHaveLength(1);
  });

  it("falha fechado quando a source não pertence ao tenant", async () => {
    const { runtime } = runtimeFor(null);
    await expect(runtime.syncPull(context, { sourceId: "other", idempotencyKey: "idem-x" }))
      .rejects.toThrow("security.cross_tenant_access_denied");
  });

  it("aplica retry apenas a falhas classificadas como transitórias", async () => {
    let attempts = 0;
    const connector: Connector = {
      sourceType: "fixture", capabilities: ["billing.read"],
      async health() { return "healthy"; },
      async pull() {
        attempts += 1;
        if (attempts < 3) throw new RetryableConnectorError();
        return { facts: [], nextCursor: "done", rateLimitRemaining: 10 };
      },
    };
    const { runtime } = runtimeFor(source, connector);
    const result = await runtime.syncPull(context, { sourceId: "source-1", idempotencyKey: "idem-1" });
    expect(attempts).toBe(3);
    expect(result).toMatchObject({ status: "completed", nextCursor: "done", rateLimitRemaining: 10 });
  });

  it("não persiste mensagem bruta de erro externo que possa conter segredo", async () => {
    const leaked = "https://provider.example.test?token=super-secret-value";
    const connector: Connector = {
      sourceType: "fixture", capabilities: ["billing.read"],
      async health() { return "healthy"; },
      async pull() { throw new Error(leaked); },
    };
    const { runtime, failures } = runtimeFor(source, connector);

    await expect(runtime.syncPull(context, { sourceId: "source-1", idempotencyKey: "idem-secret" }))
      .rejects.toThrow(leaked);

    expect(failures).toEqual([{
      errorCode: "Error",
      errorMessage: "integration.connector_failure",
    }]);
    expect(JSON.stringify(failures)).not.toContain("super-secret-value");
  });

  it("nega sync para papel sem integration:write", async () => {
    const viewer: TenantContext = { ...context, role: "viewer" };
    const { runtime } = runtimeFor();
    await expect(runtime.syncPull(viewer, { sourceId: "source-1", idempotencyKey: "idem-viewer" }))
      .rejects.toThrow("security.permission_denied:integration:write");
  });

  it("expõe health pelo connector boundary", async () => {
    const { runtime } = runtimeFor();
    await expect(runtime.health(context, "source-1")).resolves.toBe("healthy");
  });

  it("persiste o health quando o repositório suporta estado operacional", async () => {
    const updates: string[] = [];
    const sources = {
      ...sourceRepo(source),
      async updateStatus(
        tenantId: string,
        sourceId: string,
        status: "configured" | "healthy" | "degraded" | "unavailable",
      ) {
        expect(tenantId).toBe("tenant-a");
        expect(sourceId).toBe("source-1");
        updates.push(status);
      },
    };
    const runtime = new ConnectorRuntime(
      sources,
      {
        async begin() {
          return { id: "unused", state: "started" as const };
        },
        async complete() {},
        async fail() {},
      },
      { async ingest() {} },
      [{
        sourceType: "fixture",
        capabilities: ["billing.read"],
        async health() {
          return "degraded";
        },
      }],
      100,
      1,
      0,
    );

    await expect(runtime.health(context, "source-1")).resolves.toBe("degraded");
    expect(updates).toEqual(["degraded"]);
  });
});
