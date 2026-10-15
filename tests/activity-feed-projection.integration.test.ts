import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import {
  canonicalFacts,
  productDefinitions,
  sourceDefinitions,
} from "@/infrastructure/db/platform-schema";
import { PostgresActivityRepository } from "@/infrastructure/activity/postgres-activity-repository";
import {
  PostgresCanonicalFactRepository,
  PostgresSourceRepository,
} from "@/infrastructure/integration/postgres-repositories";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

const TENANTS = ["cme04-tenant-a", "cme04-tenant-b"];

afterEach(async () => {
  for (const tenantId of TENANTS) {
    await db.delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
    await db.delete(canonicalFacts).where(eq(canonicalFacts.tenantId, tenantId));
    await db.delete(sourceDefinitions).where(eq(sourceDefinitions.tenantId, tenantId));
    await db.delete(productDefinitions).where(eq(productDefinitions.tenantId, tenantId));
  }
});

describe("CME-04 Activity Feed PostgreSQL projection", () => {
  it("isola tenant/produto, filtra categoria e preserva provenance sem payload bruto", async () => {
    const products = new PostgresProductRepository();
    const productA = await products.create(TENANTS[0], {
      slug: "kordena-a",
      name: "Kordena A",
    });
    const productB = await products.create(TENANTS[0], {
      slug: "iron-b",
      name: "IRON B",
    });
    const productOtherTenant = await products.create(TENANTS[1], {
      slug: "kordena-other",
      name: "Kordena Other",
    });

    const sources = new PostgresSourceRepository();
    const sourceA = await sources.create(TENANTS[0], {
      productId: productA.id,
      name: "Billing A",
      sourceType: "kordena-commercial",
      authoritativeDomain: "billing",
      syncMode: "pull",
    });
    const sourceB = await sources.create(TENANTS[0], {
      productId: productB.id,
      name: "Billing B",
      sourceType: "fixture",
      authoritativeDomain: "billing",
      syncMode: "pull",
    });
    const sourceOther = await sources.create(TENANTS[1], {
      productId: productOtherTenant.id,
      name: "Billing Other",
      sourceType: "fixture",
      authoritativeDomain: "billing",
      syncMode: "pull",
    });

    const facts = new PostgresCanonicalFactRepository();
    await facts.ingest({
      tenantId: TENANTS[0],
      productId: productA.id,
      sourceId: sourceA.id,
      mappingVersion: "v1",
      correlationId: "fact-a",
      fact: {
        externalId: "payment-a",
        factType: "payment.settled",
        payload: {
          amount: "10.50",
          currency: "BRL",
          customerEmail: "must-not-leak@example.test",
        },
        sourceTimestamp: new Date("2026-10-04T10:00:00Z"),
      },
    });
    await facts.ingest({
      tenantId: TENANTS[0],
      productId: productB.id,
      sourceId: sourceB.id,
      mappingVersion: "v1",
      correlationId: "fact-b",
      fact: {
        externalId: "payment-b",
        factType: "payment.settled",
        payload: { amount: "990000.01", currency: "BRL" },
        sourceTimestamp: new Date("2026-10-04T10:01:00Z"),
      },
    });
    await facts.ingest({
      tenantId: TENANTS[1],
      productId: productOtherTenant.id,
      sourceId: sourceOther.id,
      mappingVersion: "v1",
      correlationId: "fact-other",
      fact: {
        externalId: "payment-other",
        factType: "payment.settled",
        payload: { amount: "777000.02", currency: "BRL" },
        sourceTimestamp: new Date("2026-10-04T10:02:00Z"),
      },
    });

    await db.insert(auditEvents).values([
      {
        tenantId: TENANTS[0],
        actorId: "owner-a",
        actorType: "user",
        action: "commercial.billing.command.forwarded",
        resourceType: "kordena_billing_control_plane",
        resourceId: "command-a",
        result: "success",
        correlationId: "audit-a",
        metadata: {
          productId: productA.id,
          rawSecret: "must-not-leak",
        },
        occurredAt: new Date("2026-10-04T10:03:00Z"),
      },
      {
        tenantId: TENANTS[0],
        actorId: "owner-a",
        actorType: "user",
        action: "alert.raised",
        resourceType: "alert_occurrence",
        resourceId: "alert-a",
        result: "attention",
        correlationId: "audit-alert",
        metadata: { productId: productA.id },
        occurredAt: new Date("2026-10-04T10:04:00Z"),
      },
    ]);

    const repository = new PostgresActivityRepository();
    const financeA = await repository.project({
      tenantId: TENANTS[0],
      productId: productA.id,
      category: "finance",
      take: 10,
    });

    expect(financeA.map((item) => item.eventType)).toEqual([
      "commercial.billing.command.forwarded",
      "payment.settled",
    ]);
    expect(financeA[1]).toMatchObject({
      productId: productA.id,
      amount: "10.50",
      currency: "BRL",
      sourceAuthority: "kordena-commercial",
      correlationId: "fact-a",
    });
    expect(financeA[1].provenanceRefs).toEqual([
      expect.stringMatching(/^canonical_fact:/),
      `source:${sourceA.id}`,
    ]);

    const serialized = JSON.stringify(financeA);
    expect(serialized).not.toContain("990000.01");
    expect(serialized).not.toContain("777000.02");
    expect(serialized).not.toContain("must-not-leak@example.test");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("rawSecret");

    const operationsA = await repository.project({
      tenantId: TENANTS[0],
      productId: productA.id,
      category: "operations",
      take: 10,
    });
    expect(operationsA.map((item) => item.eventType)).toEqual(["alert.raised"]);

    const otherTenant = await repository.project({
      tenantId: TENANTS[1],
      category: "finance",
      take: 10,
    });
    expect(otherTenant).toHaveLength(1);
    expect(otherTenant[0]).toMatchObject({
      productId: productOtherTenant.id,
      amount: "777000.02",
    });
  });
});
