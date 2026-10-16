import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  ConnectorNotReadyError,
  ConnectorUnknownError,
  SourceConfigInvalidError,
  SourceConfigurationService,
  SourceNotFoundForConfigError,
} from "@/application/integration/source-configuration-service";
import { SourceRegistryService } from "@/application/integration/source-registry-service";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";
import { connectorCatalog } from "@/infrastructure/connectors/catalog";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { sourceDefinitions } from "@/infrastructure/db/platform-schema";
import { orgUnits } from "@/infrastructure/db/unit-schema";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresUnitRepository } from "@/infrastructure/organization/postgres-unit-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

const A = "config-8e-a";
const B = "config-8e-b";
const units = new PostgresUnitRepository();
const sources = new PostgresSourceRepository();
const service = new SourceConfigurationService({
  catalog: () => connectorCatalog(),
  sources,
  registry: new SourceRegistryService(sources, new PostgresProductRepository()),
  units,
});
const ctx = (tenantId: string, role: TenantContext["role"] = "owner"): TenantContext => ({ tenantId, userId: "u", role, correlationId: "c" });
let unitA: string, unitB: string;

async function cleanup() {
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, [A, B]));
  await db.delete(sourceDefinitions).where(inArray(sourceDefinitions.tenantId, [A, B]));
  await db.delete(orgUnits).where(inArray(orgUnits.tenantId, [A, B]));
}
beforeAll(async () => {
  await cleanup();
  unitA = (await units.createUnit({ tenantId: A, kind: "company", parentId: null, name: "Matriz A" })).id;
  unitB = (await units.createUnit({ tenantId: B, kind: "company", parentId: null, name: "Matriz B" })).id;
});
afterAll(cleanup);

const bad = async (promise: Promise<unknown>, field: string) => {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(SourceConfigInvalidError);
  expect((error as SourceConfigInvalidError).field).toBe(field);
};

describe("8E configuração de fontes por empresa", () => {
  it("catálogo: Omie pronto e os demais em preparação, para quem pode ler fontes", () => {
    const entries = service.catalog(ctx(A, "analyst"));
    expect(() => service.catalog(ctx(A, "viewer"))).toThrow(PermissionDeniedError);
    expect(entries.find((e) => e.id === "omie")?.status).toBe("ready");
    expect(entries.filter((e) => e.status === "planned").length).toBeGreaterThanOrEqual(4);
  });

  it("cria fonte do Omie com configuração validada e unidade da própria empresa", async () => {
    const source = await service.createFromCatalog(ctx(A), {
      connectorId: "omie", name: " Omie Matriz ", freshnessSeconds: 3600,
      config: { currency: "BRL", utcOffsetMinutes: -180, unitRefField: "codigo_departamento", unitMap: { D1: unitA.toUpperCase() }, limits: { requestsPerMinute: 100 } },
    });
    expect(source).toMatchObject({ name: "Omie Matriz", sourceType: "omie", mappingVersion: "omie.v1", authoritativeDomain: "finance", syncMode: "pull" });
    expect(source.config).toEqual({ currency: "BRL", utcOffsetMinutes: -180, unitRefField: "codigo_departamento", unitMap: { D1: unitA }, limits: { requestsPerMinute: 100 } });
  });

  it("recusa unidade de outra empresa, limites acima do teto, campo desconhecido e baseUrl", async () => {
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: { unitMap: { D1: unitB } } }), "unitMap");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: { unitMap: { D1: "nao-e-uuid" } } }), "unitMap");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: { limits: { requestsPerMinute: 241 } } }), "limits.requestsPerMinute");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: { limits: { maxConcurrent: 5 } } }), "limits.maxConcurrent");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: { baseUrl: "https://evil.test" } }), "baseUrl");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: { apiSecret: "x" } }), "apiSecret");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: { currency: "real" } }), "currency");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: { utcOffsetMinutes: 99999 } }), "utcOffsetMinutes");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: { variables: { accountId: "a" } } }), "variables.accountId");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "   ", config: {} }), "name");
    await bad(service.createFromCatalog(ctx(A), { connectorId: "omie", name: "x", config: [] }), "config");
  });

  it("conector em preparação ou inexistente não cria fonte; leitor não cria", async () => {
    await expect(service.createFromCatalog(ctx(A), { connectorId: "bling", name: "x" })).rejects.toBeInstanceOf(ConnectorNotReadyError);
    await expect(service.createFromCatalog(ctx(A), { connectorId: "sap", name: "x" })).rejects.toBeInstanceOf(ConnectorUnknownError);
    await expect(service.createFromCatalog(ctx(A, "viewer"), { connectorId: "omie", name: "x" })).rejects.toBeInstanceOf(PermissionDeniedError);
    for (const id of ["__proto__", "constructor", "toString"]) {
      await expect(service.createFromCatalog(ctx(A), { connectorId: id, name: "x" })).rejects.toBeInstanceOf(ConnectorUnknownError);
    }
  });

  it("atualiza a configuração preservando o resto e validando de novo; outra empresa não altera", async () => {
    const source = await service.createFromCatalog(ctx(A), { connectorId: "omie", name: "Omie 2", config: { currency: "BRL", unitMap: { D1: unitA } } });
    const merged = await service.updateConfig(ctx(A), source.id, { currency: "USD" });
    expect(merged).toMatchObject({ currency: "USD", unitMap: { D1: unitA } });
    await bad(service.updateConfig(ctx(A), source.id, { unitMap: { D1: unitB } }), "unitMap");
    expect((await sources.findById(A, source.id))?.config).toMatchObject({ currency: "USD" });
    await expect(service.updateConfig(ctx(B), source.id, { currency: "EUR" })).rejects.toBeInstanceOf(SourceNotFoundForConfigError);
    await expect(service.updateConfig(ctx(A, "viewer"), source.id, { currency: "EUR" })).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await sources.findById(A, source.id))?.config.currency).toBe("USD");
  });
});
