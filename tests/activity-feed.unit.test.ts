import { describe, expect, it } from "vitest";
import { ActivityFeedService } from "@/application/activity/activity-feed-service";
import {
  ActivityQueryError,
  type ActivityProjectionRecord,
  type ActivityRepository,
} from "@/domain/activity/contracts";
import {
  PermissionDeniedError,
  type TenantContext,
} from "@/domain/security/tenant-context";

const context: TenantContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  role: "owner",
  correlationId: "corr-a",
};

function event(
  id: string,
  occurredAt: string,
  overrides: Partial<ActivityProjectionRecord> = {},
): ActivityProjectionRecord {
  return {
    id,
    category: "system",
    eventType: "core.query",
    title: "Consulta ao Core",
    occurredAt: new Date(occurredAt),
    sourceAuthority: "audit_ledger",
    provenanceRefs: [`audit_event:${id}`],
    ...overrides,
  };
}

function repository(calls: {
  tenantId?: string;
  category?: string;
  productId?: string;
  take?: number;
}): ActivityRepository {
  return {
    async recent() {
      return [];
    },
    async project(input) {
      calls.tenantId = input.tenantId;
      calls.category = input.category;
      calls.productId = input.productId;
      calls.take = input.take;
      return [
        event("e5", "2026-10-03T20:05:00Z"),
        event("e4", "2026-10-03T20:04:00Z"),
        event("e3", "2026-10-03T20:03:00Z", {
          category: "finance",
          eventType: "payment.settled",
          title: "Pagamento liquidado",
          amount: "49.90",
          unit: "currency",
          currency: "BRL",
          sourceAuthority: "kordena-commercial",
          provenanceRefs: ["canonical_fact:e3", "source:s1"],
        }),
        event("e2", "2026-10-03T20:02:00Z"),
        event("e1", "2026-10-03T20:01:00Z"),
      ];
    },
  };
}

describe("CME-04 Activity Feed", () => {
  it("pagina projeção governada preservando tenant, categoria e produto", async () => {
    const calls: {
      tenantId?: string;
      category?: string;
      productId?: string;
      take?: number;
    } = {};
    const productId = "11111111-1111-4111-8111-111111111111";
    const feed = await new ActivityFeedService(repository(calls)).page(context, {
      category: "finance",
      productId,
      page: 2,
      pageSize: 2,
    });

    expect(calls).toEqual({
      tenantId: "tenant-a",
      category: "finance",
      productId,
      take: 5,
    });
    expect(feed.items.map((item) => item.id)).toEqual(["e3", "e2"]);
    expect(feed.pagination).toEqual({
      page: 2,
      pageSize: 2,
      hasPrevious: true,
      hasNext: true,
    });
    expect(feed.items[0]).toMatchObject({
      category: "finance",
      title: "Pagamento liquidado",
      amount: "49.90",
      currency: "BRL",
      sourceAuthority: "kordena-commercial",
      occurredAt: "2026-10-03T20:03:00.000Z",
    });
  });

  it("declara fronteira sem inventar evento nem expor payload/metadata bruto", async () => {
    const feed = await new ActivityFeedService(repository({})).page(context);
    expect(feed.dataBoundary).toContain("Audit Ledger");
    expect(feed.dataBoundary).toContain("canonical facts");
    expect(feed.dataBoundary).toContain("Payload e metadata brutos não são expostos");
    expect(feed.dataBoundary).toContain("eventos sem fonte real permanecem ausentes");
    expect(JSON.stringify(feed.items)).not.toContain("payload");
    expect(JSON.stringify(feed.items)).not.toContain("metadata");
  });

  it("rejeita paginação ou productId inválido antes de consultar repositório", async () => {
    const calls: { take?: number } = {};
    const service = new ActivityFeedService(repository(calls));

    await expect(
      service.page(context, { page: 0 }),
    ).rejects.toBeInstanceOf(ActivityQueryError);
    await expect(
      service.page(context, { productId: "not-a-uuid" }),
    ).rejects.toBeInstanceOf(ActivityQueryError);
    expect(calls.take).toBeUndefined();
  });

  it("permite auditoria para analyst e bloqueia viewer/member", async () => {
    const service = new ActivityFeedService(repository({}));

    await expect(
      service.page({ ...context, role: "analyst" }),
    ).resolves.toBeDefined();
    await expect(
      service.page({ ...context, role: "viewer" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      service.page({ ...context, role: "member" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
