import { and, asc, desc, eq, sql } from "drizzle-orm";
import type {
  AlertOccurrence,
  AlertRepository,
  AlertRule,
  AlertRuleLifecycleEvent,
  GovernedActionPreview,
} from "@/domain/alerts/contracts";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function toDate(value: unknown, fallback: Date): Date {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : fallback;
}

function mapRule(row: typeof auditEvents.$inferSelect, disabled = false, archived = false): AlertRule | null {
  const m = row.metadata;
  const id = readString(m.ruleId);
  const metricId = readString(m.metricId);
  const operator = readString(m.operator);
  const threshold = readString(m.threshold);
  const severity = readString(m.severity);
  if (!id || !metricId || !threshold || !["gt","gte","lt","lte","eq"].includes(operator ?? "") ||
      !["info","warning","critical"].includes(severity ?? "")) return null;
  return {
    id,
    tenantId: row.tenantId,
    productId: readString(m.productId),
    metricId,
    operator: operator as AlertRule["operator"],
    threshold,
    severity: severity as AlertRule["severity"],
    enabled: archived || disabled ? false : (readBoolean(m.enabled) ?? true),
    archived,
    createdBy: row.actorId,
    createdAt: toDate(m.createdAt, row.occurredAt),
  };
}

function mapOccurrence(row: typeof auditEvents.$inferSelect, acknowledged: Set<string>): AlertOccurrence | null {
  const m = row.metadata;
  const id = readString(m.occurrenceId);
  const ruleId = readString(m.ruleId);
  const metricId = readString(m.metricId);
  const observedValue = readString(m.observedValue);
  const threshold = readString(m.threshold);
  const operator = readString(m.operator);
  const severity = readString(m.severity);
  const fingerprint = readString(m.fingerprint);
  if (!id || !ruleId || !metricId || observedValue === undefined || !threshold || !fingerprint ||
      !["gt","gte","lt","lte","eq"].includes(operator ?? "") || !["info","warning","critical"].includes(severity ?? "")) return null;
  return {
    id,
    tenantId: row.tenantId,
    ruleId,
    productId: readString(m.productId),
    metricId,
    observedValue,
    threshold,
    operator: operator as AlertOccurrence["operator"],
    severity: severity as AlertOccurrence["severity"],
    evidenceRefs: readStringArray(m.evidenceRefs),
    fingerprint,
    occurredAt: toDate(m.occurredAt, row.occurredAt),
    status: acknowledged.has(id) ? "acknowledged" : "active",
  };
}

export class PostgresAlertRepository implements AlertRepository {
  async createRule(input: AlertRule & { idempotencyKey: string }) {
    const resourceId = `rule:${input.id}`;
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.tenantId}:${resourceId}`}))`);
      const existing = await tx.select().from(auditEvents).where(and(
        eq(auditEvents.tenantId, input.tenantId),
        eq(auditEvents.action, "alert.rule.created"),
        eq(auditEvents.resourceId, resourceId),
      )).limit(1);
      if (existing[0]) return { rule: mapRule(existing[0]) as AlertRule, created: false };
      const rows = await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorId: input.createdBy,
        actorType: "user",
        action: "alert.rule.created",
        resourceType: "alert_rule",
        resourceId,
        result: "success",
        correlationId: input.idempotencyKey,
        metadata: {
          ruleId: input.id, productId: input.productId ?? null, metricId: input.metricId,
          operator: input.operator, threshold: input.threshold, severity: input.severity,
          enabled: input.enabled, createdAt: input.createdAt.toISOString(),
        },
      }).returning();
      return { rule: mapRule(rows[0]) as AlertRule, created: true };
    });
  }

  async listRules(tenantId: string) {
    const [rows, disabledRows, archivedRows] = await Promise.all([
      db.select().from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "alert.rule.created"),
      )).orderBy(desc(auditEvents.occurredAt)),
      db.select({ resourceId: auditEvents.resourceId }).from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "alert.rule.disabled"),
      )),
      db.select({ resourceId: auditEvents.resourceId }).from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "alert.rule.archived"),
      )),
    ]);
    const disabled = new Set(
      disabledRows
        .map((row) => row.resourceId?.replace(/^rule:/, ""))
        .filter((value): value is string => Boolean(value)),
    );
    const archived = new Set(
      archivedRows
        .map((row) => row.resourceId?.replace(/^rule:/, ""))
        .filter((value): value is string => Boolean(value)),
    );
    return rows.flatMap((row) => {
      const ruleId = readString(row.metadata.ruleId) ?? "";
      const rule = mapRule(row, disabled.has(ruleId), archived.has(ruleId));
      return rule ? [rule] : [];
    });
  }

  async findRule(tenantId: string, ruleId: string) {
    const resourceId = `rule:${ruleId}`;
    const [rows, disabledRows, archivedRows] = await Promise.all([
      db.select().from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.action, "alert.rule.created"),
        eq(auditEvents.resourceId, resourceId),
      )).limit(1),
      db.select({ resourceId: auditEvents.resourceId }).from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.action, "alert.rule.disabled"),
        eq(auditEvents.resourceId, resourceId),
      )).limit(1),
      db.select({ resourceId: auditEvents.resourceId }).from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.action, "alert.rule.archived"),
        eq(auditEvents.resourceId, resourceId),
      )).limit(1),
    ]);
    return rows[0] ? mapRule(rows[0], Boolean(disabledRows[0]), Boolean(archivedRows[0])) : null;
  }

  async disableRule(tenantId: string, ruleId: string, actorId: string, correlationId: string) {
    const resourceId = `rule:${ruleId}`;
    const created = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, tenantId),
      eq(auditEvents.action, "alert.rule.created"),
      eq(auditEvents.resourceId, resourceId),
    )).limit(1);
    if (!created[0]) return false;

    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:disable:${ruleId}`}))`);
      const existing = await tx.select().from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.action, "alert.rule.disabled"),
        eq(auditEvents.resourceId, resourceId),
      )).limit(1);
      if (!existing[0]) {
        await tx.insert(auditEvents).values({
          tenantId,
          actorId,
          actorType: "user",
          action: "alert.rule.disabled",
          resourceType: "alert_rule",
          resourceId,
          result: "success",
          correlationId,
          metadata: { ruleId, disabledAt: new Date().toISOString() },
        });
      }
    });

    return true;
  }

  async archiveRule(tenantId: string, ruleId: string, actorId: string, correlationId: string) {
    const resourceId = `rule:${ruleId}`;
    const rule = await this.findRule(tenantId, ruleId);
    if (!rule) return false;
    if (rule.enabled) return false;

    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:archive:${ruleId}`}))`);
      const existing = await tx.select().from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.action, "alert.rule.archived"),
        eq(auditEvents.resourceId, resourceId),
      )).limit(1);
      if (!existing[0]) {
        await tx.insert(auditEvents).values({
          tenantId,
          actorId,
          actorType: "user",
          action: "alert.rule.archived",
          resourceType: "alert_rule",
          resourceId,
          result: "success",
          correlationId,
          metadata: { ruleId, archivedAt: new Date().toISOString() },
        });
      }
    });
    return true;
  }

  async listRuleLifecycle(tenantId: string, ruleId: string): Promise<readonly AlertRuleLifecycleEvent[]> {
    const resourceId = `rule:${ruleId}`;
    const rows = await db.select({
      action: auditEvents.action,
      actorId: auditEvents.actorId,
      correlationId: auditEvents.correlationId,
      occurredAt: auditEvents.occurredAt,
    }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, tenantId),
      eq(auditEvents.resourceId, resourceId),
    )).orderBy(asc(auditEvents.occurredAt));

    return rows.flatMap((row) => {
      const action =
        row.action === "alert.rule.created" ? "created" :
        row.action === "alert.rule.disabled" ? "disabled" :
        row.action === "alert.rule.archived" ? "archived" :
        null;
      return action ? [{
        action,
        actorId: row.actorId,
        correlationId: row.correlationId,
        occurredAt: row.occurredAt,
      }] : [];
    });
  }

  async listOccurrencesForRule(tenantId: string, ruleId: string, limit = 100) {
    const acknowledgements = await db.select({ resourceId: auditEvents.resourceId }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "alert.acknowledged"),
    ));
    const acknowledged = new Set(
      acknowledgements
        .map((row) => row.resourceId?.replace(/^occurrence:/, ""))
        .filter((value): value is string => Boolean(value)),
    );
    const rows = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, tenantId),
      eq(auditEvents.action, "alert.raised"),
      sql`${auditEvents.metadata}->>'ruleId' = ${ruleId}`,
    )).orderBy(desc(auditEvents.occurredAt)).limit(Math.min(Math.max(limit, 1), 500));
    return rows.flatMap((row) => {
      const occurrence = mapOccurrence(row, acknowledged);
      return occurrence ? [occurrence] : [];
    });
  }

  async recordOccurrence(input: AlertOccurrence) {
    const resourceId = `occurrence:${input.fingerprint}`;
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.tenantId}:${resourceId}`}))`);
      const existing = await tx.select().from(auditEvents).where(and(
        eq(auditEvents.tenantId, input.tenantId),
        eq(auditEvents.action, "alert.raised"),
        eq(auditEvents.resourceId, resourceId),
      )).limit(1);
      if (existing[0]) {
        const occurrence = mapOccurrence(existing[0], new Set());
        return { occurrence: occurrence as AlertOccurrence, created: false };
      }
      const rows = await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorId: "system",
        actorType: "system",
        action: "alert.raised",
        resourceType: "alert_occurrence",
        resourceId,
        result: "success",
        correlationId: input.fingerprint,
        metadata: {
          occurrenceId: input.id, ruleId: input.ruleId, productId: input.productId ?? null,
          metricId: input.metricId, observedValue: input.observedValue, threshold: input.threshold,
          operator: input.operator, severity: input.severity, evidenceRefs: [...input.evidenceRefs],
          fingerprint: input.fingerprint, occurredAt: input.occurredAt.toISOString(),
        },
      }).returning();
      return { occurrence: mapOccurrence(rows[0], new Set()) as AlertOccurrence, created: true };
    });
  }

  async listOccurrences(tenantId: string, limit = 50) {
    const acknowledgements = await db.select({ resourceId: auditEvents.resourceId }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "alert.acknowledged"),
    ));
    const acknowledged = new Set(acknowledgements.map((row) => row.resourceId?.replace(/^occurrence:/, "")).filter((v): v is string => Boolean(v)));
    const rows = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "alert.raised"),
    )).orderBy(desc(auditEvents.occurredAt)).limit(Math.min(Math.max(limit, 1), 100));
    return rows.flatMap((row) => {
      const occurrence = mapOccurrence(row, acknowledged);
      return occurrence ? [occurrence] : [];
    });
  }

  async findOccurrence(tenantId: string, occurrenceId: string) {
    const rows = await db.select().from(auditEvents).where(and(
      eq(auditEvents.tenantId, tenantId),
      eq(auditEvents.action, "alert.raised"),
      sql`${auditEvents.metadata}->>'occurrenceId' = ${occurrenceId}`,
    )).limit(1);
    if (!rows[0]) return null;

    const acknowledgements = await db.select({ resourceId: auditEvents.resourceId }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, tenantId),
      eq(auditEvents.action, "alert.acknowledged"),
      eq(auditEvents.resourceId, `occurrence:${occurrenceId}`),
    )).limit(1);

    return mapOccurrence(
      rows[0],
      acknowledgements[0] ? new Set([occurrenceId]) : new Set(),
    );
  }

  async acknowledge(tenantId: string, occurrenceId: string, actorId: string, correlationId: string) {
    const target = await this.findOccurrence(tenantId, occurrenceId);
    if (!target) return false;
    const resourceId = `occurrence:${occurrenceId}`;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:ack:${occurrenceId}`}))`);
      const existing = await tx.select().from(auditEvents).where(and(
        eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, "alert.acknowledged"), eq(auditEvents.resourceId, resourceId),
      )).limit(1);
      if (!existing[0]) {
        await tx.insert(auditEvents).values({
          tenantId, actorId, actorType: "user", action: "alert.acknowledged",
          resourceType: "alert_occurrence", resourceId, result: "success", correlationId,
          metadata: { occurrenceId },
        });
      }
    });
    return true;
  }

  async recordActionPreview(input: GovernedActionPreview & { actorId: string; correlationId: string }) {
    const resourceId = `intent:${input.fingerprint}`;
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.tenantId}:${resourceId}`}))`);
      const existing = await tx.select().from(auditEvents).where(and(
        eq(auditEvents.tenantId, input.tenantId), eq(auditEvents.action, "action.intent.prepared"), eq(auditEvents.resourceId, resourceId),
      )).limit(1);
      if (existing[0]) return { preview: input, created: false };
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId, actorId: input.actorId, actorType: "user",
        action: "action.intent.prepared", resourceType: "governed_action_intent",
        resourceId, result: "success", correlationId: input.correlationId,
        metadata: {
          previewId: input.id, occurrenceId: input.occurrenceId, actionType: input.actionType,
          riskLevel: input.riskLevel, requiresConfirmation: input.requiresConfirmation,
          executable: false, reason: input.reason, fingerprint: input.fingerprint,
          createdAt: input.createdAt.toISOString(),
        },
      });
      return { preview: input, created: true };
    });
  }
}
