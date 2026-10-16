import { describe, expect, it } from "vitest";
import { GlobalSearchService } from "@/application/search/global-search-service";
import { GlobalSearchQueryError } from "@/domain/search/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

const owner: TenantContext = {
  tenantId: "tenant-a",
  userId: "owner-a",
  role: "owner",
  correlationId: "corr-a",
};

function buildService(options?: {
  sourceCounter?: { value: number };
  activityCounter?: { value: number };
  rateLimitCounter?: { value: number };
  kordenaCommercial?: boolean;
}) {
  return new GlobalSearchService(
    {
      async list() {
        return [
          {
            id: "product-kordena",
            tenantId: "tenant-a",
            slug: "kordena",
            name: "Kordena",
            status: "active" as const,
          },
          {
            id: "product-cross-tenant",
            tenantId: "tenant-b",
            slug: "secret-product",
            name: "Produto de outro tenant",
            status: "active" as const,
          },
        ];
      },
    },
    {
      async list() {
        if (options?.sourceCounter) options.sourceCounter.value += 1;
        return [
          {
            id: "source-kordena",
            tenantId: "tenant-a",
            productId: "product-kordena",
            name: "Kordena Commercial",
            sourceType: "kordena-commercial",
            authoritativeDomain: "commercial",
            status: "healthy" as const,
            syncMode: "pull" as const,
            secretRef: "env:SEARCH_MUST_NOT_EXPOSE_ME",
            config: {
              apiKey: "api-secret-must-not-be-searchable",
              baseUrl: "https://private.example.test",
            },
            mappingVersion: "v1",
          },
          {
            id: "source-cross-tenant",
            tenantId: "tenant-b",
            name: "Fonte secreta de outro tenant",
            sourceType: "secret",
            authoritativeDomain: "other",
            status: "healthy" as const,
            syncMode: "pull" as const,
            config: {},
            mappingVersion: "v1",
          },
        ];
      },
    },
    {
      async listRules() {
        return [
          {
            id: "rule-service-errors",
            tenantId: "tenant-a",
            metricId: "service.error.count",
            operator: "gt" as const,
            threshold: "10",
            severity: "critical" as const,
            enabled: true,
            archived: false,
            createdBy: "owner-a",
            createdAt: new Date("2026-10-03T10:00:00Z"),
          },
          {
            id: "rule-cross-tenant",
            tenantId: "tenant-b",
            metricId: "incident.count",
            operator: "gt" as const,
            threshold: "1",
            severity: "warning" as const,
            enabled: true,
            archived: false,
            createdBy: "other",
            createdAt: new Date("2026-10-03T10:00:00Z"),
          },
        ];
      },
      async listOccurrences() {
        return [
          {
            id: "occurrence-service-errors",
            tenantId: "tenant-a",
            ruleId: "rule-service-errors",
            metricId: "service.error.count",
            observedValue: "12",
            threshold: "10",
            operator: "gt" as const,
            severity: "critical" as const,
            evidenceRefs: ["private-evidence-ref"],
            fingerprint: "private-fingerprint",
            occurredAt: new Date("2026-10-03T10:05:00Z"),
            status: "active" as const,
          },
          {
            id: "occurrence-cross-tenant",
            tenantId: "tenant-b",
            ruleId: "rule-cross-tenant",
            metricId: "incident.count",
            observedValue: "2",
            threshold: "1",
            operator: "gt" as const,
            severity: "warning" as const,
            evidenceRefs: [],
            fingerprint: "other",
            occurredAt: new Date("2026-10-03T10:05:00Z"),
            status: "active" as const,
          },
        ];
      },
    },
    {
      async recent(tenantId) {
        if (options?.activityCounter) options.activityCounter.value += 1;
        expect(tenantId).toBe("tenant-a");
        return [
          {
            id: "activity-payment",
            actorId: "sensitive-actor@example.test",
            actorType: "user",
            action: "billing.payment.settled",
            resourceType: "payment",
            resourceId: "customer-sensitive-id",
            result: "success",
            correlationId: "corr-sensitive",
            occurredAt: new Date("2026-10-03T10:06:00Z"),
          },
        ];
      },
    },
    {
      async consume(input) {
        if (options?.rateLimitCounter) options.rateLimitCounter.value += 1;
        expect(input.tenantId).toBe("tenant-a");
        expect(input.userId).toBe("owner-a");
      },
    },
    async () => ({
      kordenaCommercial: options?.kordenaCommercial ?? true,
    }),
  );
}

describe("R9 Global Search", () => {
  it("compõe navegação, produto e fonte no tenant sem expor secrets/config", async () => {
    const result = await buildService().search(owner, "kordena", 20);

    expect(result.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["navigation", "product", "source"]),
    );
    expect(result.items.some((item) => item.id === "product:product-cross-tenant")).toBe(false);
    expect(result.items.some((item) => item.id === "source:source-cross-tenant")).toBe(false);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SEARCH_MUST_NOT_EXPOSE_ME");
    expect(serialized).not.toContain("api-secret-must-not-be-searchable");
    expect(serialized).not.toContain("private.example.test");
  });

  it("não inventa módulo Kordena quando a feature não está configurada no tenant", async () => {
    const result = await buildService({ kordenaCommercial: false }).search(
      owner,
      "kordena",
      20,
    );

    expect(
      result.items.some(
        (item) =>
          item.kind === "navigation" &&
          item.href === "/dashboard/commercial/kordena",
      ),
    ).toBe(false);
    expect(result.items.some((item) => item.kind === "product")).toBe(true);
    expect(result.items.some((item) => item.kind === "source")).toBe(true);
  });

  it("não consulta Source Registry nem atividades sem as permissões correspondentes", async () => {
    const sourceCounter = { value: 0 };
    const activityCounter = { value: 0 };
    const result = await buildService({ sourceCounter, activityCounter }).search(
      { ...owner, role: "viewer" },
      "kordena",
    );

    expect(sourceCounter.value).toBe(0);
    expect(activityCounter.value).toBe(0);
    expect(result.items.some((item) => item.kind === "source")).toBe(false);
    expect(result.items.some((item) => item.kind === "activity")).toBe(false);
    expect(result.items.some((item) => item.kind === "product")).toBe(true);
  });

  it("normaliza acentos e localiza Configurações apenas como superfície autorizada", async () => {
    const result = await buildService().search(owner, "configuracoes");
    expect(
      result.items.some(
        (item) =>
          item.kind === "navigation" &&
          item.href === "/dashboard/settings",
      ),
    ).toBe(true);
  });

  it("expõe métricas pendentes como semântica pendente, nunca como valor inventado", async () => {
    const result = await buildService().search(owner, "MRR");
    const metric = result.items.find(
      (item) => item.id === "metric:revenue.mrr",
    );

    expect(metric).toBeDefined();
    expect(metric?.description).toContain("Semântica pendente");
    expect(metric?.authority).toBe("executive_metric_target");
    expect(metric?.href).toBe("/dashboard/finance");
  });

  it("localiza regra e ocorrência de alerta mantendo escopo do tenant", async () => {
    const result = await buildService().search(owner, "service.error");

    expect(
      result.items.some(
        (item) => item.id === "alert_rule:rule-service-errors",
      ),
    ).toBe(true);
    expect(
      result.items.some(
        (item) => item.id === "alert_occurrence:occurrence-service-errors",
      ),
    ).toBe(true);
    expect(
      result.items.some(
        (item) =>
          item.id === "alert_rule:rule-cross-tenant" ||
          item.id === "alert_occurrence:occurrence-cross-tenant",
      ),
    ).toBe(false);
  });

  it("busca atividade auditável sem expor ator, resourceId, correlação ou metadata", async () => {
    const result = await buildService().search(owner, "payment");
    const activity = result.items.find(
      (item) => item.id === "activity:activity-payment",
    );

    expect(activity?.authority).toBe("audit_ledger");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sensitive-actor@example.test");
    expect(serialized).not.toContain("customer-sensitive-id");
    expect(serialized).not.toContain("corr-sensitive");
    expect(serialized).not.toContain("private-evidence-ref");
    expect(serialized).not.toContain("private-fingerprint");
  });

  it("aplica rate limit somente a consultas válidas e limita resultados", async () => {
    const rateLimitCounter = { value: 0 };
    const service = buildService({ rateLimitCounter });

    await expect(service.search(owner, "x")).rejects.toBeInstanceOf(
      GlobalSearchQueryError,
    );
    await expect(
      service.search(owner, "a".repeat(81)),
    ).rejects.toBeInstanceOf(GlobalSearchQueryError);
    expect(rateLimitCounter.value).toBe(0);

    const validLimited = await service.search(owner, "co", 1);
    expect(rateLimitCounter.value).toBe(1);
    expect(validLimited.items).toHaveLength(1);
    expect(validLimited.counts.returned).toBe(1);
  });
});
