import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { recordAuditEvent } from "@/application/audit/record-audit-event";
import type { TenantContext } from "@/domain/security/tenant-context";
import { AuditCoreContextReader } from "@/infrastructure/core/audit-core-context-reader";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

const TENANT_A = "core-audit-it-tenant-a";
const TENANT_B = "core-audit-it-tenant-b";
const USER_A = "core-audit-it-user-a";
const USER_A2 = "core-audit-it-user-a2";
const USER_B = "core-audit-it-user-b";

function context(tenantId: string, userId: string, correlationId: string): TenantContext {
  return { tenantId, userId, role: "owner", correlationId };
}

afterEach(async () => {
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, [TENANT_A, TENANT_B]));
});

describe("F09 Cognitive Core audit + tenant isolation", () => {
  it("persiste core.query com tenant, ator, correlação, resultado e evidence refs", async () => {
    const ctx = context(TENANT_A, USER_A, "core-audit-corr-a");

    await recordAuditEvent(ctx, {
      action: "core.query",
      resourceType: "cognitive_core",
      result: "success",
      metadata: {
        question: "Quanto faturamos?",
        answer: "R$ 100",
        factualStatus: "grounded",
        evidenceRefs: ["billing.gross_billed"],
        productRefs: ["kordena"],
      },
    });

    const rows = await db
      .select()
      .from(auditEvents)
      .where(and(
        eq(auditEvents.tenantId, TENANT_A),
        eq(auditEvents.actorId, USER_A),
        eq(auditEvents.action, "core.query"),
      ));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT_A,
      actorId: USER_A,
      actorType: "user",
      action: "core.query",
      resourceType: "cognitive_core",
      result: "success",
      correlationId: "core-audit-corr-a",
    });
    expect(rows[0].metadata).toMatchObject({
      factualStatus: "grounded",
      evidenceRefs: ["billing.gross_billed"],
      productRefs: ["kordena"],
    });
  });

  it("memória operacional não cruza tenant nem usuário", async () => {
    await recordAuditEvent(context(TENANT_A, USER_A, "corr-a1"), {
      action: "core.query",
      resourceType: "cognitive_core",
      result: "success",
      metadata: {
        question: "Pergunta A",
        answer: "Resposta A",
        factualStatus: "grounded",
        evidenceRefs: ["billing.gross_billed"],
      },
    });

    await recordAuditEvent(context(TENANT_A, USER_A2, "corr-a2"), {
      action: "core.query",
      resourceType: "cognitive_core",
      result: "success",
      metadata: {
        question: "Pergunta A2",
        answer: "Resposta A2",
        factualStatus: "grounded",
        evidenceRefs: ["trial.starts.count"],
      },
    });

    await recordAuditEvent(context(TENANT_B, USER_B, "corr-b1"), {
      action: "core.query",
      resourceType: "cognitive_core",
      result: "success",
      metadata: {
        question: "Pergunta B",
        answer: "Resposta B",
        factualStatus: "grounded",
        evidenceRefs: ["revenue.cash_collected"],
      },
    });

    const reader = new AuditCoreContextReader();
    const tenantAUserA = await reader.recent({ tenantId: TENANT_A, userId: USER_A, limit: 10 });
    const tenantAUserA2 = await reader.recent({ tenantId: TENANT_A, userId: USER_A2, limit: 10 });
    const tenantBUserB = await reader.recent({ tenantId: TENANT_B, userId: USER_B, limit: 10 });

    expect(tenantAUserA).toHaveLength(1);
    expect(tenantAUserA[0]).toMatchObject({ question: "Pergunta A", answer: "Resposta A" });

    expect(tenantAUserA2).toHaveLength(1);
    expect(tenantAUserA2[0]).toMatchObject({ question: "Pergunta A2", answer: "Resposta A2" });

    expect(tenantBUserB).toHaveLength(1);
    expect(tenantBUserB[0]).toMatchObject({ question: "Pergunta B", answer: "Resposta B" });

    expect(tenantAUserA.map((item) => item.question)).toEqual(["Pergunta A"]);
    expect(tenantAUserA2.map((item) => item.question)).toEqual(["Pergunta A2"]);
    expect(tenantBUserB.map((item) => item.question)).toEqual(["Pergunta B"]);
  });

  it("ignora eventos de falha na memória de continuidade", async () => {
    await recordAuditEvent(context(TENANT_A, USER_A, "corr-failure"), {
      action: "core.query",
      resourceType: "cognitive_core",
      result: "failure",
      metadata: {
        question: "Pergunta com falha",
        error: "core.cognitive_model_unavailable",
      },
    });

    const rows = await new AuditCoreContextReader().recent({ tenantId: TENANT_A, userId: USER_A, limit: 10 });
    expect(rows).toEqual([]);
  });
});
