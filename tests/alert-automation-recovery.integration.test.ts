import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { PostgresAlertAutomationRepository } from "@/infrastructure/alerts/postgres-alert-automation-repository";

const RUN_IDS = [
  "f20-auto-recent-0001",
  "f20-auto-stale-0001",
  "f20-auto-failed-0001",
  "f20-auto-completed-0001",
];

afterEach(async () => {
  for (const runId of RUN_IDS) {
    await db.delete(auditEvents).where(and(
      eq(auditEvents.tenantId, "system"),
      eq(auditEvents.resourceId, `run:${runId}`),
    ));
  }
});

describe("F20 alert automation recovery", () => {
  it("mantém execução recente como duplicada", async () => {
    const repository = new PostgresAlertAutomationRepository();
    const first = await repository.beginRun({
      runId: RUN_IDS[0],
      correlationId: "corr-recent-a",
    });
    const duplicate = await repository.beginRun({
      runId: RUN_IDS[0],
      correlationId: "corr-recent-b",
    });

    expect(first).toBe("started");
    expect(duplicate).toBe("duplicate");
  });

  it("recupera started órfão quando já está stale", async () => {
    const runId = RUN_IDS[1];
    await db.insert(auditEvents).values({
      tenantId: "system",
      actorId: "fmcc-alert-scheduler",
      actorType: "system",
      action: "alert.automation.started",
      resourceType: "alert_automation_run",
      resourceId: `run:${runId}`,
      result: "success",
      correlationId: "corr-stale-a",
      metadata: { runId, startedAt: "2026-09-23T00:00:00Z" },
      occurredAt: new Date(Date.now() - 11 * 60 * 1000),
    });

    const repository = new PostgresAlertAutomationRepository();
    await expect(repository.beginRun({
      runId,
      correlationId: "corr-stale-b",
    })).resolves.toBe("restarted");

    const events = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, "system"),
      eq(auditEvents.resourceId, `run:${runId}`),
    ));
    expect(events.some((event) => event.action === "alert.automation.restarted")).toBe(true);
  });

  it("permite retry governado depois de falha terminal registrada", async () => {
    const runId = RUN_IDS[2];
    const repository = new PostgresAlertAutomationRepository();
    await repository.beginRun({ runId, correlationId: "corr-failed-a" });
    await repository.failRun({
      runId,
      correlationId: "corr-failed-a",
      errorCode: "UpstreamFailure",
    });

    await expect(repository.beginRun({
      runId,
      correlationId: "corr-failed-b",
    })).resolves.toBe("restarted");
  });

  it("nunca reinicia run já concluído", async () => {
    const runId = RUN_IDS[3];
    const repository = new PostgresAlertAutomationRepository();
    await repository.beginRun({ runId, correlationId: "corr-complete-a" });
    await repository.completeRun({
      runId,
      correlationId: "corr-complete-a",
      tenants: 0,
      rulesEvaluated: 0,
      occurrencesCreated: 0,
      unavailable: 0,
      clear: 0,
      incompatible: 0,
      failures: 0,
    });

    await expect(repository.beginRun({
      runId,
      correlationId: "corr-complete-b",
    })).resolves.toBe("duplicate");
  });
});
