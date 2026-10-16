import { describe, expect, it } from "vitest";
import { AlertRuleDuplicateError, AlertService } from "@/application/alerts/alert-service";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import { compareAlertThresholdDefinition, evaluateAlertThreshold, type AlertOccurrence, type AlertRepository, type AlertRule, type AlertRuleLifecycleEvent, type GovernedActionPreview } from "@/domain/alerts/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = { tenantId: "tenant-alert", userId: "user-alert", role: "owner", correlationId: "corr-alert" };

function metric(value: string | null, freshness: MetricView["freshnessStatus"] = "fresh"): MetricView {
  return {
    metricId: "incident.count", metricVersion: 1, value, unit: "count",
    periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T23:59:59Z"),
    computedAt: new Date("2026-09-30T23:59:59Z"), freshnessStatus: freshness,
    qualityStatus: value === null ? "missing" : "verified", sourceAuthority: "test",
    provenanceRefs: ["fact-alert-1"],
  };
}

function rule(operator: AlertRule["operator"] = "gte", threshold = "10"): AlertRule {
  return {
    id: "rule-1", tenantId: context.tenantId, metricId: "incident.count",
    operator, threshold, severity: "warning", enabled: true, archived: false,
    createdBy: context.userId, createdAt: new Date(),
  };
}

class MemoryRepository implements AlertRepository {
  rules: AlertRule[] = [rule()];
  occurrences: AlertOccurrence[] = [];
  previews: GovernedActionPreview[] = [];
  lifecycle: AlertRuleLifecycleEvent[] = [];
  async createRule(input: AlertRule) { this.rules.push(input); return { rule: input, created: true }; }
  async listRules(tenantId: string) { return this.rules.filter((item) => item.tenantId === tenantId); }
  async findRule(tenantId: string, ruleId: string) { return this.rules.find((item) => item.tenantId === tenantId && item.id === ruleId) ?? null; }
  async disableRule(tenantId: string, ruleId: string) {
    const index = this.rules.findIndex((item) => item.tenantId === tenantId && item.id === ruleId);
    if (index < 0) return false;
    this.rules[index] = { ...this.rules[index], enabled: false };
    return true;
  }
  async archiveRule(tenantId: string, ruleId: string) {
    const index = this.rules.findIndex((item) => item.tenantId === tenantId && item.id === ruleId);
    if (index < 0 || this.rules[index]?.enabled) return false;
    this.rules[index] = { ...this.rules[index], archived: true };
    return true;
  }
  async listRuleLifecycle() { return this.lifecycle; }
  async listOccurrencesForRule(tenantId: string, ruleId: string) {
    return this.occurrences.filter((item) => item.tenantId === tenantId && item.ruleId === ruleId);
  }
  async recordOccurrence(input: AlertOccurrence) {
    const existing = this.occurrences.find((item) => item.fingerprint === input.fingerprint);
    if (existing) return { occurrence: existing, created: false };
    this.occurrences.push(input); return { occurrence: input, created: true };
  }
  async listOccurrences(tenantId: string) { return this.occurrences.filter((item) => item.tenantId === tenantId); }
  async findOccurrence(tenantId: string, occurrenceId: string) { return this.occurrences.find((item) => item.tenantId === tenantId && item.id === occurrenceId) ?? null; }
  async acknowledge(tenantId: string, occurrenceId: string) {
    const index = this.occurrences.findIndex((item) => item.tenantId === tenantId && item.id === occurrenceId);
    if (index < 0) return false;
    this.occurrences[index] = { ...this.occurrences[index], status: "acknowledged" };
    return true;
  }
  async recordActionPreview(input: GovernedActionPreview) {
    const existing = this.previews.find((item) => item.fingerprint === input.fingerprint);
    if (existing) return { preview: existing, created: false };
    this.previews.push(input); return { preview: input, created: true };
  }
}

describe("F17 governed alerts", () => {
  it("respeita boundaries de threshold", () => {
    expect(evaluateAlertThreshold(rule("gt", "10"), metric("10")).status).toBe("clear");
    expect(evaluateAlertThreshold(rule("gte", "10"), metric("10")).status).toBe("triggered");
    expect(evaluateAlertThreshold(rule("lt", "10"), metric("9.9")).status).toBe("triggered");
    expect(evaluateAlertThreshold(rule("eq", "10.00"), metric("10")).status).toBe("triggered");
  });

  it("não converte missing ou stale em alerta", () => {
    expect(evaluateAlertThreshold(rule(), metric(null)).status).toBe("unavailable");
    expect(evaluateAlertThreshold(rule(), metric("99", "stale"))).toMatchObject({ status: "unavailable", reason: "stale_or_unavailable" });
  });

  it("compara regra arquivada em modo somente leitura sem reativá-la", () => {
    const archived = { ...rule("gt", "10"), enabled: false, archived: true };
    expect(evaluateAlertThreshold(archived, metric("12"))).toMatchObject({ status: "clear", reason: "rule_disabled" });
    expect(compareAlertThresholdDefinition(archived, metric("12"))).toMatchObject({ status: "triggered", observedValue: "12" });
  });

  it("impede regra ativa semanticamente duplicada", async () => {
    const repository = new MemoryRepository();
    repository.rules = [{
      ...rule("gt", "10"),
      metricId: "trial.starts.count",
      severity: "warning",
    }];
    const metrics = { async query() { return null; } } as unknown as MetricService;
    const service = new AlertService(repository, metrics);

    await expect(service.createRule(context, {
      metricId: "trial.starts.count",
      operator: "gt",
      threshold: "10",
      severity: "warning",
      idempotencyKey: "duplicate-rule-12345",
    })).rejects.toBeInstanceOf(AlertRuleDuplicateError);
  });

  it("desativa regra sem apagar o histórico", async () => {
    const repository = new MemoryRepository();
    const metrics = { async query() { return null; } } as unknown as MetricService;
    const service = new AlertService(repository, metrics);
    const result = await service.disableRule(context, "rule-1");
    expect(result.status).toBe("disabled");
    expect(repository.rules[0]?.enabled).toBe(false);
  });

  it("arquiva regra somente após desativação e preserva o registro", async () => {
    const repository = new MemoryRepository();
    const metrics = { async query() { return null; } } as unknown as MetricService;
    const service = new AlertService(repository, metrics);

    await expect(service.archiveRule(context, "rule-1")).rejects.toThrow("alert.rule_must_be_disabled");
    await service.disableRule(context, "rule-1");
    const archived = await service.archiveRule(context, "rule-1");
    expect(archived.status).toBe("archived");
    expect(repository.rules[0]).toMatchObject({ enabled: false, archived: true });
  });

  it("expõe detalhe arquivado sem criar ocorrência", async () => {
    const repository = new MemoryRepository();
    repository.rules[0] = { ...repository.rules[0]!, enabled: false, archived: true };
    repository.lifecycle = [
      { action: "created", actorId: "user-alert", correlationId: "corr-created", occurredAt: new Date("2026-09-23T10:00:00Z") },
      { action: "disabled", actorId: "user-alert", correlationId: "corr-disabled", occurredAt: new Date("2026-09-23T11:00:00Z") },
      { action: "archived", actorId: "user-alert", correlationId: "corr-archived", occurredAt: new Date("2026-09-23T12:00:00Z") },
    ];
    const metrics = { async query() { return metric("12"); } } as unknown as MetricService;
    const service = new AlertService(repository, metrics);

    const detail = await service.ruleDetail(context, "rule-1");
    expect(detail.readOnly).toBe(true);
    expect(detail.rule).toMatchObject({ enabled: false, archived: true });
    expect(detail.lifecycle.map((event) => event.action)).toEqual(["created", "disabled", "archived"]);
    expect(detail.comparison.status).toBe("triggered");
    expect(repository.occurrences).toHaveLength(0);
  });

  it("é idempotente para a mesma observação e provenance", async () => {
    const repository = new MemoryRepository();
    const metrics = { async query() { return metric("12"); } } as unknown as MetricService;
    const service = new AlertService(repository, metrics);
    const first = await service.evaluate(context, "rule-1");
    const second = await service.evaluate(context, "rule-1");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(repository.occurrences).toHaveLength(1);
  });

  it("prepara ação de alto risco sem torná-la executável", async () => {
    const repository = new MemoryRepository();
    const metrics = { async query() { return metric("12"); } } as unknown as MetricService;
    const service = new AlertService(repository, metrics);
    const raised = await service.evaluate(context, "rule-1");
    const result = await service.prepareAction(context, {
      occurrenceId: raised.occurrence?.id as string,
      actionType: "external_change",
      idempotencyKey: "intent-12345678",
    });
    expect(result.preview).toMatchObject({ riskLevel: "high", requiresConfirmation: true, executable: false });
  });
});
