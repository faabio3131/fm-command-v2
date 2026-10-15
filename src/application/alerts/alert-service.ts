import type { MetricService } from "@/application/metrics/metric-service";
import { ProductRegistryService } from "@/application/products/product-registry-service";
import {
  actionRisk,
  compareAlertThresholdDefinition,
  evaluateAlertThreshold,
  stableFingerprint,
  validDecimalThreshold,
  type AlertOperator,
  type AlertRepository,
  type AlertRule,
  type AlertSeverity,
  type GovernedActionType,
} from "@/domain/alerts/contracts";
import { getMetricDefinition } from "@/domain/metrics/registry";
import type { ProductRepository } from "@/domain/products/contracts";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

export class AlertDefinitionInvalidError extends Error { constructor() { super("alert.definition_invalid"); } }
export class AlertRuleDuplicateError extends Error { constructor() { super("alert.rule_duplicate"); } }
export class AlertRuleNotFoundError extends Error { constructor() { super("alert.rule_not_found"); } }
export class AlertRuleMustBeDisabledError extends Error { constructor() { super("alert.rule_must_be_disabled"); } }
export class AlertOccurrenceNotFoundError extends Error { constructor() { super("alert.occurrence_not_found"); } }
export class AlertActionInvalidError extends Error { constructor() { super("alert.action_invalid"); } }

export class AlertService {
  private readonly products?: ProductRegistryService;

  constructor(
    private readonly repository: AlertRepository,
    private readonly metrics: MetricService,
    products?: ProductRepository,
  ) {
    this.products = products ? new ProductRegistryService(products) : undefined;
  }

  async overview(context: TenantContext) {
    requirePermission(context, "alert:read");
    const [rules, occurrences] = await Promise.all([
      this.repository.listRules(context.tenantId),
      this.repository.listOccurrences(context.tenantId, 50),
    ]);
    return { rules, occurrences };
  }

  async createRule(context: TenantContext, input: {
    metricId: string;
    productId?: string;
    operator: AlertOperator;
    threshold: string;
    severity: AlertSeverity;
    idempotencyKey: string;
  }) {
    requirePermission(context, "alert:write");
    if (!getMetricDefinition(input.metricId) || !validDecimalThreshold(input.threshold) || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
      throw new AlertDefinitionInvalidError();
    }
    if (!["gt","gte","lt","lte","eq"].includes(input.operator) || !["info","warning","critical"].includes(input.severity)) {
      throw new AlertDefinitionInvalidError();
    }
    if (input.productId && this.products) await this.products.get(context, input.productId);
    const normalizedThreshold = input.threshold.trim();
    const existingRules = await this.repository.listRules(context.tenantId);
    const duplicate = existingRules.some((rule) =>
      rule.enabled &&
      rule.metricId === input.metricId &&
      (rule.productId ?? "") === (input.productId ?? "") &&
      rule.operator === input.operator &&
      rule.threshold === normalizedThreshold &&
      rule.severity === input.severity
    );
    if (duplicate) throw new AlertRuleDuplicateError();
    const id = stableFingerprint([context.tenantId, "rule", input.idempotencyKey]).slice(0, 32);
    const rule: AlertRule = {
      id,
      tenantId: context.tenantId,
      productId: input.productId,
      metricId: input.metricId,
      operator: input.operator,
      threshold: normalizedThreshold,
      severity: input.severity,
      enabled: true,
      archived: false,
      createdBy: context.userId,
      createdAt: new Date(),
    };
    return this.repository.createRule({ ...rule, idempotencyKey: input.idempotencyKey });
  }

  async disableRule(context: TenantContext, ruleId: string) {
    requirePermission(context, "alert:write");
    const rule = await this.repository.findRule(context.tenantId, ruleId);
    if (!rule) throw new AlertRuleNotFoundError();
    const disabled = await this.repository.disableRule(context.tenantId, ruleId, context.userId, context.correlationId);
    if (!disabled) throw new AlertRuleNotFoundError();
    return { ruleId, status: "disabled" as const };
  }

  async archiveRule(context: TenantContext, ruleId: string) {
    requirePermission(context, "alert:write");
    const rule = await this.repository.findRule(context.tenantId, ruleId);
    if (!rule) throw new AlertRuleNotFoundError();
    if (rule.enabled) throw new AlertRuleMustBeDisabledError();
    if (rule.archived) return { ruleId, status: "archived" as const };
    const archived = await this.repository.archiveRule(context.tenantId, ruleId, context.userId, context.correlationId);
    if (!archived) throw new AlertRuleNotFoundError();
    return { ruleId, status: "archived" as const };
  }

  async ruleDetail(context: TenantContext, ruleId: string) {
    requirePermission(context, "alert:read");
    const rule = await this.repository.findRule(context.tenantId, ruleId);
    if (!rule) throw new AlertRuleNotFoundError();
    const [lifecycle, occurrences, currentMetric] = await Promise.all([
      this.repository.listRuleLifecycle(context.tenantId, ruleId),
      this.repository.listOccurrencesForRule(context.tenantId, ruleId, 100),
      this.metrics.query(context, rule.metricId, rule.productId),
    ]);
    const comparison = compareAlertThresholdDefinition(rule, currentMetric);
    return {
      rule,
      lifecycle,
      occurrences,
      currentMetric,
      comparison,
      readOnly: true as const,
    };
  }

  async evaluate(context: TenantContext, ruleId: string) {
    requirePermission(context, "alert:write");
    const rule = await this.repository.findRule(context.tenantId, ruleId);
    if (!rule) throw new AlertRuleNotFoundError();
    if (rule.productId && this.products) await this.products.get(context, rule.productId);
    const value = await this.metrics.query(context, rule.metricId, rule.productId);
    const evaluation = evaluateAlertThreshold(rule, value);
    if (evaluation.status !== "triggered" || !value || value.value === null) {
      return { rule, evaluation, occurrence: null, created: false };
    }

    const fingerprint = stableFingerprint([
      context.tenantId,
      rule.id,
      rule.metricId,
      rule.productId ?? "global",
      value.value,
      value.sourceTimestamp?.toISOString() ?? value.computedAt.toISOString(),
      ...value.provenanceRefs,
    ]);
    const occurrence = {
      id: fingerprint.slice(0, 32),
      tenantId: context.tenantId,
      ruleId: rule.id,
      productId: rule.productId,
      metricId: rule.metricId,
      observedValue: value.value,
      threshold: rule.threshold,
      operator: rule.operator,
      severity: rule.severity,
      evidenceRefs: value.provenanceRefs,
      fingerprint,
      occurredAt: new Date(),
      status: "active" as const,
    };
    const persisted = await this.repository.recordOccurrence(occurrence);
    return { rule, evaluation, ...persisted };
  }

  async acknowledge(context: TenantContext, occurrenceId: string) {
    requirePermission(context, "alert:write");
    const ok = await this.repository.acknowledge(context.tenantId, occurrenceId, context.userId, context.correlationId);
    if (!ok) throw new AlertOccurrenceNotFoundError();
    return { occurrenceId, status: "acknowledged" as const };
  }

  async prepareAction(context: TenantContext, input: {
    occurrenceId: string;
    actionType: GovernedActionType;
    idempotencyKey: string;
  }) {
    requirePermission(context, "action:prepare");
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey) ||
        !["acknowledge_alert","investigate","draft_communication","external_change"].includes(input.actionType)) {
      throw new AlertActionInvalidError();
    }
    const occurrence = await this.repository.findOccurrence(
      context.tenantId,
      input.occurrenceId,
    );
    if (!occurrence) throw new AlertOccurrenceNotFoundError();
    const riskLevel = actionRisk(input.actionType);
    const fingerprint = stableFingerprint([context.tenantId, input.occurrenceId, input.actionType, input.idempotencyKey]);
    const preview = {
      id: fingerprint.slice(0, 32),
      tenantId: context.tenantId,
      occurrenceId: input.occurrenceId,
      actionType: input.actionType,
      riskLevel,
      requiresConfirmation: riskLevel !== "low",
      executable: false as const,
      reason: riskLevel === "high"
        ? "Ação de alto risco permanece somente em prévia; execução externa não é autorizada na F17."
        : riskLevel === "medium"
          ? "Ação de médio risco exige confirmação humana antes de qualquer execução futura."
          : "A F17 prepara a intenção auditável; nenhum efeito externo é executado.",
      fingerprint,
      createdAt: new Date(),
    };
    return this.repository.recordActionPreview({ ...preview, actorId: context.userId, correlationId: context.correlationId });
  }
}
