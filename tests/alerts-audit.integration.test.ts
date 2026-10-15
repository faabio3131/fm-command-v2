import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { PostgresAlertRepository } from "@/infrastructure/alerts/postgres-alert-repository";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

const TENANT = "alert-idempotency-it";

afterEach(async () => {
  await db.delete(auditEvents).where(eq(auditEvents.tenantId, TENANT));
});

describe("F17 alert audit repository", () => {
  it("serializa ocorrência concorrente por fingerprint sem duplicar side effect", async () => {
    const repository = new PostgresAlertRepository();
    const occurrence = {
      id: "occurrence-1",
      tenantId: TENANT,
      ruleId: "rule-1",
      metricId: "incident.count",
      observedValue: "12",
      threshold: "10",
      operator: "gte" as const,
      severity: "warning" as const,
      evidenceRefs: ["fact-1"],
      fingerprint: "fingerprint-concurrent-1",
      occurredAt: new Date("2026-09-23T00:00:00Z"),
      status: "active" as const,
    };

    const [a, b] = await Promise.all([
      repository.recordOccurrence(occurrence),
      repository.recordOccurrence(occurrence),
    ]);

    expect([a.created, b.created].sort()).toEqual([false, true]);
    const rows = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, TENANT),
      eq(auditEvents.action, "alert.raised"),
    ));
    expect(rows).toHaveLength(1);
  });

  it("desativa regra de forma auditável e idempotente", async () => {
    const repository = new PostgresAlertRepository();
    await repository.createRule({
      id: "rule-disable",
      tenantId: TENANT,
      metricId: "trial.starts.count",
      operator: "gt",
      threshold: "10",
      severity: "warning",
      enabled: true,
      archived: false,
      createdBy: "user-a",
      createdAt: new Date(),
      idempotencyKey: "rule-disable-12345",
    });

    expect(await repository.disableRule(TENANT, "rule-disable", "user-a", "corr-disable-a")).toBe(true);
    expect(await repository.disableRule(TENANT, "rule-disable", "user-a", "corr-disable-b")).toBe(true);

    const rules = await repository.listRules(TENANT);
    expect(rules.find((item) => item.id === "rule-disable")?.enabled).toBe(false);

    const rows = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, TENANT),
      eq(auditEvents.action, "alert.rule.disabled"),
    ));
    expect(rows).toHaveLength(1);
  });

  it("arquiva regra desativada preservando audit trail e idempotência", async () => {
    const repository = new PostgresAlertRepository();
    await repository.createRule({
      id: "rule-archive",
      tenantId: TENANT,
      metricId: "trial.starts.count",
      operator: "gt",
      threshold: "10",
      severity: "warning",
      enabled: true,
      archived: false,
      createdBy: "user-a",
      createdAt: new Date(),
      idempotencyKey: "rule-archive-12345",
    });

    expect(await repository.archiveRule(TENANT, "rule-archive", "user-a", "corr-before-disable")).toBe(false);
    expect(await repository.disableRule(TENANT, "rule-archive", "user-a", "corr-disable")).toBe(true);
    expect(await repository.archiveRule(TENANT, "rule-archive", "user-a", "corr-archive-a")).toBe(true);
    expect(await repository.archiveRule(TENANT, "rule-archive", "user-a", "corr-archive-b")).toBe(true);

    const rule = (await repository.listRules(TENANT)).find((item) => item.id === "rule-archive");
    expect(rule).toMatchObject({ enabled: false, archived: true });

    const rows = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, TENANT),
      eq(auditEvents.action, "alert.rule.archived"),
    ));
    expect(rows).toHaveLength(1);

    const lifecycle = await repository.listRuleLifecycle(TENANT, "rule-archive");
    expect(lifecycle.map((event) => event.action)).toEqual(["created", "disabled", "archived"]);
  });


  it("mantém mais de 100 regras disponíveis para autoridade operacional", async () => {
    const repository = new PostgresAlertRepository();
    const createdAt = new Date("2026-09-23T12:00:00Z");
    await db.insert(auditEvents).values(
      Array.from({ length: 105 }, (_, index) => ({
        tenantId: TENANT,
        actorId: "user-a",
        actorType: "user",
        action: "alert.rule.created",
        resourceType: "alert_rule",
        resourceId: `rule:rule-volume-${index}`,
        result: "success",
        correlationId: `corr-volume-${index}`,
        metadata: {
          ruleId: `rule-volume-${index}`,
          productId: null,
          metricId: "trial.starts.count",
          operator: "gt",
          threshold: String(index + 1),
          severity: "warning",
          enabled: true,
          createdAt: new Date(createdAt.getTime() + index).toISOString(),
        },
        occurredAt: new Date(createdAt.getTime() + index),
      })),
    );

    const rules = await repository.listRules(TENANT);
    expect(rules).toHaveLength(105);
    expect(rules.some((rule) => rule.id === "rule-volume-0")).toBe(true);
    expect(rules.some((rule) => rule.id === "rule-volume-104")).toBe(true);
  });

  it("lista somente ocorrências persistidas da regra solicitada", async () => {
    const repository = new PostgresAlertRepository();
    await repository.recordOccurrence({
      id: "occurrence-rule-a",
      tenantId: TENANT,
      ruleId: "rule-a",
      metricId: "incident.count",
      observedValue: "12",
      threshold: "10",
      operator: "gt",
      severity: "warning",
      evidenceRefs: ["fact-a"],
      fingerprint: "fingerprint-rule-a",
      occurredAt: new Date("2026-09-23T13:00:00Z"),
      status: "active",
    });
    await repository.recordOccurrence({
      id: "occurrence-rule-b",
      tenantId: TENANT,
      ruleId: "rule-b",
      metricId: "incident.count",
      observedValue: "15",
      threshold: "10",
      operator: "gt",
      severity: "critical",
      evidenceRefs: ["fact-b"],
      fingerprint: "fingerprint-rule-b",
      occurredAt: new Date("2026-09-23T14:00:00Z"),
      status: "active",
    });

    const rows = await repository.listOccurrencesForRule(TENANT, "rule-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("occurrence-rule-a");
  });

  it("reconhece ocorrência antiga depois de mais de 100 eventos", async () => {
    const repository = new PostgresAlertRepository();
    const base = new Date("2026-09-23T18:00:00Z");

    await db.insert(auditEvents).values(
      Array.from({ length: 105 }, (_, index) => ({
        tenantId: TENANT,
        actorId: "system",
        actorType: "system",
        action: "alert.raised",
        resourceType: "alert_occurrence",
        resourceId: `occurrence:fingerprint-volume-${index}`,
        result: "success",
        correlationId: `fingerprint-volume-${index}`,
        metadata: {
          occurrenceId: `occ-volume-${index}`,
          ruleId: "rule-volume",
          productId: null,
          metricId: "incident.count",
          observedValue: String(index + 1),
          threshold: "1",
          operator: "gt",
          severity: "warning",
          evidenceRefs: [],
          fingerprint: `fingerprint-volume-${index}`,
          occurredAt: new Date(base.getTime() + index).toISOString(),
        },
        occurredAt: new Date(base.getTime() + index),
      })),
    );

    const old = await repository.findOccurrence(TENANT, "occ-volume-0");
    expect(old?.id).toBe("occ-volume-0");

    await expect(
      repository.acknowledge(
        TENANT,
        "occ-volume-0",
        "user-a",
        "corr-old-ack",
      ),
    ).resolves.toBe(true);

    const acknowledged = await repository.findOccurrence(TENANT, "occ-volume-0");
    expect(acknowledged?.status).toBe("acknowledged");
  });

  it("torna acknowledgement idempotente", async () => {
    const repository = new PostgresAlertRepository();
    await repository.recordOccurrence({
      id: "occurrence-ack",
      tenantId: TENANT,
      ruleId: "rule-ack",
      metricId: "incident.count",
      observedValue: "15",
      threshold: "10",
      operator: "gt",
      severity: "critical",
      evidenceRefs: ["fact-ack"],
      fingerprint: "fingerprint-ack",
      occurredAt: new Date(),
      status: "active",
    });

    await Promise.all([
      repository.acknowledge(TENANT, "occurrence-ack", "user-a", "corr-a"),
      repository.acknowledge(TENANT, "occurrence-ack", "user-a", "corr-b"),
    ]);

    const rows = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, TENANT),
      eq(auditEvents.action, "alert.acknowledged"),
    ));
    expect(rows).toHaveLength(1);
    const occurrences = await repository.listOccurrences(TENANT);
    expect(occurrences[0]?.status).toBe("acknowledged");
  });
});
