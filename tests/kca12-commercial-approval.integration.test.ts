import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  CommercialApprovalRequiredError,
  consumeCommercialApproval,
  issueCommercialApproval,
} from "@/application/integration/commercial-approval";
import type { TenantContext } from "@/domain/security/tenant-context";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

const TENANT = "commercial-approval-it";
const context: TenantContext = {
  tenantId: TENANT,
  userId: "owner-commercial",
  role: "owner",
  correlationId: "corr-commercial-approval",
};

const payload = {
  expected_plan_version: 3,
  effective_from: "2026-10-01T00:00:00Z",
  change_reason: "Publicação governada de teste",
};

afterEach(async () => {
  await db.delete(auditEvents).where(eq(auditEvents.tenantId, TENANT));
});

describe("Kordena commercial server-side approval", () => {
  it("emite aprovação auditável e permite consumo único para o mesmo payload", async () => {
    const approval = await issueCommercialApproval(context, {
      sourceId: "source-kordena",
      resourceId: "plan-version-3",
      publishAction: "plan_version.publish",
      publishPayload: payload,
    });

    expect(approval.token.length).toBeGreaterThanOrEqual(32);

    const issued = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, TENANT),
      eq(auditEvents.action, "commercial.command.preview_approved"),
    ));
    expect(issued).toHaveLength(1);
    expect(JSON.stringify(issued[0]?.metadata)).not.toContain(approval.token);

    await consumeCommercialApproval(context, {
      sourceId: "source-kordena",
      resourceId: "plan-version-3",
      publishAction: "plan_version.publish",
      publishPayload: payload,
      token: approval.token,
    });

    const consumed = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, TENANT),
      eq(auditEvents.action, "commercial.command.approval_consumed"),
    ));
    expect(consumed).toHaveLength(1);

    await expect(
      consumeCommercialApproval(context, {
        sourceId: "source-kordena",
        resourceId: "plan-version-3",
        publishAction: "plan_version.publish",
        publishPayload: payload,
        token: approval.token,
      }),
    ).rejects.toThrow("commercial.approval_already_used");
  });

  it("recusa aprovação quando o payload de publicação diverge da prévia", async () => {
    const approval = await issueCommercialApproval(context, {
      sourceId: "source-kordena",
      resourceId: "price-1",
      publishAction: "price.publish",
      publishPayload: { expected_plan_version: 2, change_reason: "Preço A" },
    });

    await expect(
      consumeCommercialApproval(context, {
        sourceId: "source-kordena",
        resourceId: "price-1",
        publishAction: "price.publish",
        publishPayload: { expected_plan_version: 2, change_reason: "Preço B" },
        token: approval.token,
      }),
    ).rejects.toBeInstanceOf(CommercialApprovalRequiredError);
  });



  it("continua bloqueando replay mesmo após mais de 100 consumos posteriores", async () => {
    const approval = await issueCommercialApproval(context, {
      sourceId: "source-kordena",
      resourceId: "price-high-volume",
      publishAction: "price.publish",
      publishPayload: payload,
    });

    await consumeCommercialApproval(context, {
      sourceId: "source-kordena",
      resourceId: "price-high-volume",
      publishAction: "price.publish",
      publishPayload: payload,
      token: approval.token,
    });

    const later = Array.from({ length: 150 }, (_, index) => ({
      tenantId: TENANT,
      actorId: context.userId,
      actorType: "user",
      action: "commercial.command.approval_consumed",
      resourceType: "kordena_commercial_publish_approval",
      resourceId: `other-${index}`,
      result: "success",
      correlationId: `later-${index}`,
      metadata: {
        tokenHash: `other-token-hash-${index}`,
        sourceId: "source-kordena",
        publishAction: "price.publish",
        payloadHash: `other-payload-${index}`,
      },
      occurredAt: new Date(Date.now() + 1_000 + index),
    }));
    await db.insert(auditEvents).values(later);

    await expect(
      consumeCommercialApproval(context, {
        sourceId: "source-kordena",
        resourceId: "price-high-volume",
        publishAction: "price.publish",
        publishPayload: payload,
        token: approval.token,
      }),
    ).rejects.toThrow("commercial.approval_already_used");
  });

  it("recusa reutilização da aprovação por outro usuário", async () => {
    const approval = await issueCommercialApproval(context, {
      sourceId: "source-kordena",
      resourceId: "promotion-version-1",
      publishAction: "promotion_version.publish",
      publishPayload: { expected_promotion_version: 1, change_reason: "Promoção" },
    });

    await expect(
      consumeCommercialApproval(
        { ...context, userId: "other-admin", correlationId: "corr-other" },
        {
          sourceId: "source-kordena",
          resourceId: "promotion-version-1",
          publishAction: "promotion_version.publish",
          publishPayload: { expected_promotion_version: 1, change_reason: "Promoção" },
          token: approval.token,
        },
      ),
    ).rejects.toBeInstanceOf(CommercialApprovalRequiredError);
  });
});
