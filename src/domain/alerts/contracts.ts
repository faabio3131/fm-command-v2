import { createHash } from "node:crypto";
import type { MetricView } from "@/application/metrics/metric-service";

export type AlertOperator = "gt" | "gte" | "lt" | "lte" | "eq";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertEvaluationStatus = "triggered" | "clear" | "unavailable" | "incompatible";
export type ActionRiskLevel = "low" | "medium" | "high";
export type GovernedActionType = "acknowledge_alert" | "investigate" | "draft_communication" | "external_change";

export interface AlertRule {
  readonly id: string;
  readonly tenantId: string;
  readonly productId?: string;
  readonly metricId: string;
  readonly operator: AlertOperator;
  readonly threshold: string;
  readonly severity: AlertSeverity;
  readonly enabled: boolean;
  readonly archived: boolean;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface AlertOccurrence {
  readonly id: string;
  readonly tenantId: string;
  readonly ruleId: string;
  readonly productId?: string;
  readonly metricId: string;
  readonly observedValue: string;
  readonly threshold: string;
  readonly operator: AlertOperator;
  readonly severity: AlertSeverity;
  readonly evidenceRefs: readonly string[];
  readonly fingerprint: string;
  readonly occurredAt: Date;
  readonly status: "active" | "acknowledged";
}

export interface AlertRuleLifecycleEvent {
  readonly action: "created" | "disabled" | "archived";
  readonly actorId: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
}

export interface GovernedActionPreview {
  readonly id: string;
  readonly tenantId: string;
  readonly occurrenceId: string;
  readonly actionType: GovernedActionType;
  readonly riskLevel: ActionRiskLevel;
  readonly requiresConfirmation: boolean;
  readonly executable: false;
  readonly reason: string;
  readonly fingerprint: string;
  readonly createdAt: Date;
}

export interface AlertRepository {
  createRule(input: AlertRule & { idempotencyKey: string }): Promise<{ rule: AlertRule; created: boolean }>;
  listRules(tenantId: string): Promise<readonly AlertRule[]>;
  findRule(tenantId: string, ruleId: string): Promise<AlertRule | null>;
  disableRule(tenantId: string, ruleId: string, actorId: string, correlationId: string): Promise<boolean>;
  archiveRule(tenantId: string, ruleId: string, actorId: string, correlationId: string): Promise<boolean>;
  listRuleLifecycle(tenantId: string, ruleId: string): Promise<readonly AlertRuleLifecycleEvent[]>;
  listOccurrencesForRule(tenantId: string, ruleId: string, limit?: number): Promise<readonly AlertOccurrence[]>;
  recordOccurrence(input: AlertOccurrence): Promise<{ occurrence: AlertOccurrence; created: boolean }>;
  listOccurrences(tenantId: string, limit?: number): Promise<readonly AlertOccurrence[]>;
  findOccurrence(tenantId: string, occurrenceId: string): Promise<AlertOccurrence | null>;
  acknowledge(tenantId: string, occurrenceId: string, actorId: string, correlationId: string): Promise<boolean>;
  recordActionPreview(input: GovernedActionPreview & { actorId: string; correlationId: string }): Promise<{ preview: GovernedActionPreview; created: boolean }>;
}

function decimalParts(raw: string): { units: bigint; scale: number } | null {
  const value = raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  return { units: BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n), scale: fraction.length };
}

function compareDecimal(left: string, right: string): number | null {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  const av = a.units * 10n ** BigInt(scale - a.scale);
  const bv = b.units * 10n ** BigInt(scale - b.scale);
  return av === bv ? 0 : av > bv ? 1 : -1;
}

export function validDecimalThreshold(value: string): boolean {
  return decimalParts(value) !== null;
}

export function compareAlertThresholdDefinition(rule: AlertRule, value: MetricView | null): {
  status: AlertEvaluationStatus;
  observedValue?: string;
  reason?: string;
} {
  if (!value || value.value === null) return { status: "unavailable", reason: "missing_value" };
  if (value.freshnessStatus === "stale" || value.freshnessStatus === "unavailable") {
    return { status: "unavailable", reason: "stale_or_unavailable" };
  }
  const compared = compareDecimal(value.value, rule.threshold);
  if (compared === null) return { status: "incompatible", reason: "numeric_value" };
  const triggered =
    rule.operator === "gt" ? compared > 0 :
    rule.operator === "gte" ? compared >= 0 :
    rule.operator === "lt" ? compared < 0 :
    rule.operator === "lte" ? compared <= 0 :
    compared === 0;
  return { status: triggered ? "triggered" : "clear", observedValue: value.value };
}

export function evaluateAlertThreshold(rule: AlertRule, value: MetricView | null): {
  status: AlertEvaluationStatus;
  observedValue?: string;
  reason?: string;
} {
  if (!rule.enabled) return { status: "clear", reason: "rule_disabled" };
  return compareAlertThresholdDefinition(rule, value);
}

export function stableFingerprint(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function actionRisk(actionType: GovernedActionType): ActionRiskLevel {
  if (actionType === "acknowledge_alert" || actionType === "investigate") return "low";
  if (actionType === "draft_communication") return "medium";
  return "high";
}
