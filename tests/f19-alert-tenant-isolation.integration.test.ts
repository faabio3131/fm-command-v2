import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { AlertOccurrenceNotFoundError, AlertService } from "@/application/alerts/alert-service";
import type { MetricService } from "@/application/metrics/metric-service";
import type { TenantContext } from "@/domain/security/tenant-context";
import { PostgresAlertRepository } from "@/infrastructure/alerts/postgres-alert-repository";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

const TENANT_A = "f19-alert-tenant-a";
const TENANT_B = "f19-alert-tenant-b";

function context(tenantId: string): TenantContext {
  return { tenantId, userId: `user-${tenantId}`, role: "owner", correlationId: `corr-${tenantId}` };
}

afterEach(async () => {
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, [TENANT_A, TENANT_B]));
});

describe("F19 alert/action tenant isolation", () => {
  it("não lista regra nem ocorrência de outro tenant e bloqueia ação cruzada", async () => {
    const repository = new PostgresAlertRepository();

    const created = await repository.createRule({
      id: "rule-a",
      tenantId: TENANT_A,
      metricId: "incident.count",
      operator: "gte",
      threshold: "1",
      severity: "critical",
      enabled: true,
      archived: false,
      createdBy: "user-a",
      createdAt: new Date("2026-09-23T00:00:00Z"),
      idempotencyKey: "rule-a-idempotency",
    });
    expect(created.created).toBe(true);

    await repository.recordOccurrence({
      id: "occurrence-a",
      tenantId: TENANT_A,
      ruleId: "rule-a",
      metricId: "incident.count",
      observedValue: "2",
      threshold: "1",
      operator: "gte",
      severity: "critical",
      evidenceRefs: ["fact-a"],
      fingerprint: "fingerprint-a",
      occurredAt: new Date("2026-09-23T00:01:00Z"),
      status: "active",
    });

    expect(await repository.listRules(TENANT_B)).toEqual([]);
    expect(await repository.listOccurrences(TENANT_B)).toEqual([]);
    expect(await repository.acknowledge(TENANT_B, "occurrence-a", "user-b", "corr-b")).toBe(false);

    const serviceB = new AlertService(
      repository,
      { async query() { return null; } } as unknown as MetricService,
    );
    await expect(serviceB.prepareAction(context(TENANT_B), {
      occurrenceId: "occurrence-a",
      actionType: "external_change",
      idempotencyKey: "tenant-b-action-123",
    })).rejects.toBeInstanceOf(AlertOccurrenceNotFoundError);

    const rowsB = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT_B));
    expect(rowsB).toEqual([]);
  });
});
