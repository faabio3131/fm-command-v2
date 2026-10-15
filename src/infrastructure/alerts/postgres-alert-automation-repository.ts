import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { db } from "@/infrastructure/db/client";

const AUTOMATION_STALE_AFTER_MS = 10 * 60 * 1000;

export class PostgresAlertAutomationRepository {
  async listTenantIdsWithRules(): Promise<readonly string[]> {
    const rows = await db
      .selectDistinct({ tenantId: auditEvents.tenantId })
      .from(auditEvents)
      .where(eq(auditEvents.action, "alert.rule.created"));
    return rows.map((row) => row.tenantId);
  }

  async beginRun(input: {
    runId: string;
    correlationId: string;
  }): Promise<"started" | "restarted" | "duplicate"> {
    return db.transaction(async (tx) => {
      const resourceId = `run:${input.runId}`;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`alert-automation:${input.runId}`}))`,
      );

      const lifecycle = await tx
        .select({
          action: auditEvents.action,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .where(and(
          eq(auditEvents.tenantId, "system"),
          eq(auditEvents.resourceId, resourceId),
        ))
        .orderBy(desc(auditEvents.occurredAt));

      if (lifecycle.some((event) => event.action === "alert.automation.completed")) {
        return "duplicate";
      }

      const lastStart = lifecycle.find((event) =>
        event.action === "alert.automation.started" ||
        event.action === "alert.automation.restarted"
      );
      const lastFailure = lifecycle.find(
        (event) => event.action === "alert.automation.failed",
      );
      const failedAfterLastStart =
        Boolean(lastFailure) &&
        (!lastStart ||
          (lastFailure?.occurredAt.getTime() ?? 0) >=
            lastStart.occurredAt.getTime());
      const stale =
        Boolean(lastStart) &&
        Date.now() - (lastStart?.occurredAt.getTime() ?? Date.now()) >=
          AUTOMATION_STALE_AFTER_MS;

      if (lastStart && !failedAfterLastStart && !stale) {
        return "duplicate";
      }

      const action =
        lastStart || failedAfterLastStart
          ? "alert.automation.restarted"
          : "alert.automation.started";
      await tx.insert(auditEvents).values({
        tenantId: "system",
        actorId: "fmcc-alert-scheduler",
        actorType: "system",
        action,
        resourceType: "alert_automation_run",
        resourceId,
        result: "success",
        correlationId: input.correlationId,
        metadata: {
          runId: input.runId,
          startedAt: new Date().toISOString(),
          recoveryReason: failedAfterLastStart
            ? "previous_failure"
            : stale
              ? "stale_started_run"
              : null,
        },
      });
      return action === "alert.automation.started" ? "started" : "restarted";
    });
  }

  async failRun(input: {
    runId: string;
    correlationId: string;
    errorCode: string;
  }): Promise<void> {
    await db.insert(auditEvents).values({
      tenantId: "system",
      actorId: "fmcc-alert-scheduler",
      actorType: "system",
      action: "alert.automation.failed",
      resourceType: "alert_automation_run",
      resourceId: `run:${input.runId}`,
      result: "failure",
      correlationId: input.correlationId,
      metadata: {
        runId: input.runId,
        errorCode: input.errorCode.slice(0, 120),
        failedAt: new Date().toISOString(),
      },
    });
  }

  async completeRun(input: {
    runId: string;
    correlationId: string;
    tenants: number;
    rulesEvaluated: number;
    occurrencesCreated: number;
    unavailable: number;
    clear: number;
    incompatible: number;
    failures: number;
  }): Promise<void> {
    await db.insert(auditEvents).values({
      tenantId: "system",
      actorId: "fmcc-alert-scheduler",
      actorType: "system",
      action: "alert.automation.completed",
      resourceType: "alert_automation_run",
      resourceId: `run:${input.runId}`,
      result: input.failures > 0 ? "failure" : "success",
      correlationId: input.correlationId,
      metadata: {
        runId: input.runId,
        tenants: input.tenants,
        rulesEvaluated: input.rulesEvaluated,
        occurrencesCreated: input.occurrencesCreated,
        unavailable: input.unavailable,
        clear: input.clear,
        incompatible: input.incompatible,
        failures: input.failures,
        completedAt: new Date().toISOString(),
      },
    });
  }

  newCorrelationId(): string {
    return `automation-${randomUUID()}`;
  }
}
