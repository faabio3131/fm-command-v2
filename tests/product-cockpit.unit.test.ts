import { describe, expect, it } from "vitest";
import { ProductCockpitService } from "@/application/products/product-cockpit-service";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  role: "owner",
  correlationId: "corr-a",
};

type ProductReader = ConstructorParameters<typeof ProductCockpitService>[0];
type GrowthReader = ConstructorParameters<typeof ProductCockpitService>[1];
type FinanceReader = ConstructorParameters<typeof ProductCockpitService>[2];
type CustomerReader = ConstructorParameters<typeof ProductCockpitService>[3];
type OperationsReader = ConstructorParameters<typeof ProductCockpitService>[4];
type HealthReader = ConstructorParameters<typeof ProductCockpitService>[5];
type AlertReader = ConstructorParameters<typeof ProductCockpitService>[6];
type SourceReader = ConstructorParameters<typeof ProductCockpitService>[7];

function service() {
  const product = {
    id: "p1",
    tenantId: "tenant-a",
    slug: "kordena",
    name: "Kordena",
    status: "active" as const,
  };

  const productIntelligence = {
    async overview() {
      return {
        product,
        metrics: [
          { target: { metricId: "m1" }, status: "available" as const, value: { value: "1" } },
          { target: { metricId: "m2" }, status: "pending_semantics" as const, value: null },
          { target: { metricId: "m3" }, status: "unavailable" as const, value: null },
        ],
        growth: [],
      };
    },
  } as unknown as ProductReader;

  const growth = {
    async overview() {
      return { productId: "p1", metrics: [], attribution: { status: "pending_semantics", reason: "pending" }, funnel: { status: "pending_semantics", reason: "pending" } };
    },
  } as unknown as GrowthReader;

  const finance = {
    async overview() {
      return { productId: "p1", metrics: [], operatingResult: { status: "unavailable" }, unitEconomics: [] };
    },
  } as unknown as FinanceReader;

  const customer = {
    async overview() {
      return {
        productId: "p1",
        metrics: [],
        factualSignals: [],
        customerRisk: { status: "pending_semantics", score: null, reason: "pending" },
        adoption: { status: "pending_semantics", reason: "pending" },
        privacy: { surface: "aggregate_only", note: "aggregate" },
      };
    },
  } as unknown as CustomerReader;

  const operations = {
    async overview() {
      return {
        productId: "p1",
        metrics: [],
        runtime: { healthEndpoint: "/api/health", readinessEndpoint: "/api/ready", healthStatus: "endpoint_available", readinessStatus: "endpoint_available" },
        availability: { status: "pending_semantics", reason: "pending" },
        alerts: { status: "signals_only", reason: "signals" },
      };
    },
  } as unknown as OperationsReader;

  const health = {
    async overview() {
      return {
        productId: "p1",
        services: [],
        counts: { operational: 0, degraded: 0, unavailable: 0, unknown: 0 },
        availability: { value: null, reason: "pending" },
      };
    },
  } as unknown as HealthReader;

  const alerts = {
    async overview() {
      return {
        rules: [
          { id: "r1", productId: "p1", enabled: true, archived: false },
          { id: "r2", productId: "p2", enabled: true, archived: false },
        ],
        occurrences: [
          { id: "o1", productId: "p1", status: "active", severity: "critical" },
          { id: "o2", productId: "p1", status: "acknowledged", severity: "warning" },
          { id: "o3", productId: "p2", status: "active", severity: "critical" },
        ],
      };
    },
  } as unknown as AlertReader;

  const sources = {
    async list() {
      return [
        {
          id: "source-p1",
          tenantId: "tenant-a",
          productId: "p1",
          name: "Kordena Commercial",
          sourceType: "kordena-commercial",
          authoritativeDomain: "commercial",
          status: "healthy",
          syncMode: "pull",
          secretRef: "env:SHOULD_NEVER_LEAVE_SERVICE",
          config: { apiKey: "also-must-not-leave-service" },
          freshnessSeconds: 60,
          mappingVersion: "v2",
        },
        {
          id: "source-p2",
          tenantId: "tenant-a",
          productId: "p2",
          name: "IRON",
          sourceType: "iron",
          authoritativeDomain: "operations",
          status: "degraded",
          syncMode: "pull",
          config: {},
          mappingVersion: "v1",
        },
        {
          id: "source-shared",
          tenantId: "tenant-a",
          name: "Shared tenant source",
          sourceType: "shared",
          authoritativeDomain: "shared",
          status: "configured",
          syncMode: "hybrid",
          config: {},
          mappingVersion: "v1",
        },
      ];
    },
  } as unknown as SourceReader;

  return new ProductCockpitService(
    productIntelligence,
    growth,
    finance,
    customer,
    operations,
    health,
    alerts,
    sources,
  );
}

describe("R5 Product Cockpit", () => {
  it("compõe autoridades existentes sem converter gaps em zero", async () => {
    const result = await service().overview(context, "p1");

    expect(result.product.slug).toBe("kordena");
    expect(result.coverage).toEqual({
      total: 3,
      available: 1,
      pendingSemantics: 1,
      unavailable: 1,
    });
  });

  it("filtra regras e ocorrências pelo productId governado", async () => {
    const result = await service().overview(context, "p1");

    expect(result.alerts.rules.map((rule) => rule.id)).toEqual(["r1"]);
    expect(result.alerts.occurrences.map((occurrence) => occurrence.id)).toEqual(["o1", "o2"]);
    expect(result.alerts.counts).toEqual({
      enabledRules: 1,
      recentActive: 1,
      recentCriticalActive: 1,
      recentAcknowledged: 1,
    });
  });

  it("declara explicitamente que alertas são janela recente, não total histórico", async () => {
    const result = await service().overview(context, "p1");
    expect(result.alerts.windowNote).toContain("janela recente");
    expect(result.alerts.windowNote).toContain("não um total histórico");
  });

  it("expõe somente integrações explicitamente atribuídas ao produto e remove secrets/config", async () => {
    const result = await service().overview(context, "p1");

    expect(result.integrations.items).toEqual([
      {
        id: "source-p1",
        name: "Kordena Commercial",
        sourceType: "kordena-commercial",
        authoritativeDomain: "commercial",
        status: "healthy",
        syncMode: "pull",
        freshnessSeconds: 60,
        mappingVersion: "v2",
      },
    ]);
    expect(result.integrations.counts).toEqual({
      total: 1,
      healthy: 1,
      configured: 0,
      degraded: 0,
      unavailable: 0,
    });
    expect(result.integrations.sharedTenantSourceCount).toBe(1);
    expect(JSON.stringify(result.integrations)).not.toContain("secretRef");
    expect(JSON.stringify(result.integrations)).not.toContain("SHOULD_NEVER_LEAVE_SERVICE");
    expect(JSON.stringify(result.integrations)).not.toContain("also-must-not-leave-service");
  });
});
