import { describe, expect, it, vi, afterEach } from "vitest";
import {
  AlertActionInvalidError,
  AlertDefinitionInvalidError,
  AlertService,
} from "@/application/alerts/alert-service";
import {
  ExecutiveAnalysisArgumentError,
  ExecutiveAnalysisService,
} from "@/application/executive/executive-analysis-service";
import type { MetricService } from "@/application/metrics/metric-service";
import type {
  AlertOccurrence,
  AlertRepository,
  AlertRule,
  GovernedActionPreview,
} from "@/domain/alerts/contracts";
import {
  CognitiveModelContractError,
  CognitiveModelUnavailableError,
} from "@/domain/core/cognitive-model";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";
import { OpenAiCompatibleCognitiveModel } from "@/infrastructure/core/openai-compatible-cognitive-model";

const owner: TenantContext = { tenantId: "tenant-f19", userId: "owner", role: "owner", correlationId: "corr-owner" };
const viewer: TenantContext = { ...owner, userId: "viewer", role: "viewer", correlationId: "corr-viewer" };

class MemoryAlertRepository implements AlertRepository {
  readonly rules: AlertRule[] = [];
  readonly occurrences: AlertOccurrence[] = [];
  readonly previews: GovernedActionPreview[] = [];
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
  async listRuleLifecycle() { return []; }
  async listOccurrencesForRule(tenantId: string, ruleId: string) {
    return this.occurrences.filter((item) => item.tenantId === tenantId && item.ruleId === ruleId);
  }
  async recordOccurrence(input: AlertOccurrence) { this.occurrences.push(input); return { occurrence: input, created: true }; }
  async listOccurrences(tenantId: string) { return this.occurrences.filter((item) => item.tenantId === tenantId); }
  async findOccurrence(tenantId: string, occurrenceId: string) { return this.occurrences.find((item) => item.tenantId === tenantId && item.id === occurrenceId) ?? null; }
  async acknowledge(tenantId: string, occurrenceId: string) { return this.occurrences.some((item) => item.tenantId === tenantId && item.id === occurrenceId); }
  async recordActionPreview(input: GovernedActionPreview) { this.previews.push(input); return { preview: input, created: true }; }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F19 adversarial boundaries", () => {
  it("nega escrita de alerta e preparação de ação para viewer", async () => {
    const service = new AlertService(
      new MemoryAlertRepository(),
      { async query() { return null; } } as unknown as MetricService,
    );

    await expect(service.createRule(viewer, {
      metricId: "incident.count",
      operator: "gt",
      threshold: "1",
      severity: "warning",
      idempotencyKey: "rule-viewer-12345",
    })).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(service.evaluate(viewer, "rule-1")).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(service.prepareAction(viewer, {
      occurrenceId: "occurrence-1",
      actionType: "investigate",
      idempotencyKey: "action-viewer-12345",
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("rejeita threshold e action type inválidos antes de qualquer efeito", async () => {
    const repository = new MemoryAlertRepository();
    const service = new AlertService(
      repository,
      { async query() { return null; } } as unknown as MetricService,
    );

    await expect(service.createRule(owner, {
      metricId: "incident.count",
      operator: "gt",
      threshold: "NaN",
      severity: "warning",
      idempotencyKey: "invalid-rule-12345",
    })).rejects.toBeInstanceOf(AlertDefinitionInvalidError);

    await expect(service.prepareAction(owner, {
      occurrenceId: "occurrence-1",
      actionType: "drop_database" as never,
      idempotencyKey: "invalid-action-12345",
    })).rejects.toBeInstanceOf(AlertActionInvalidError);

    expect(repository.rules).toHaveLength(0);
    expect(repository.previews).toHaveLength(0);
  });

  it("rejeita métrica executiva fora do catálogo governado", async () => {
    const service = new ExecutiveAnalysisService({
      async query() { throw new Error("should-not-query"); },
    } as unknown as MetricService);

    await expect(service.overview(owner, {
      metricIds: ["metric.forbidden"],
    })).rejects.toBeInstanceOf(ExecutiveAnalysisArgumentError);
  });

  it("falha fechado quando provider cognitivo retorna erro HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider failed", { status: 503 })));
    const model = new OpenAiCompatibleCognitiveModel(
      "https://models.example.test",
      "unit-test-token",
      "approved-model",
    );

    await expect(model.plan({
      question: "O que precisa da minha atenção?",
      metricCatalog: [{ metricId: "incident.count", displayName: "Incidentes", description: "Incidentes governados" }],
      operationalContext: [],
    })).rejects.toBeInstanceOf(CognitiveModelUnavailableError);
  });

  it("falha fechado em transporte do provider cognitivo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network unavailable"); }));
    const model = new OpenAiCompatibleCognitiveModel(
      "https://models.example.test",
      "unit-test-token",
      "approved-model",
    );

    await expect(model.synthesize({
      question: "Explique",
      facts: [{ metricId: "incident.count", value: "2" }],
      evidence: [{ kind: "metric", ref: "incident.count" }],
      operationalContext: [],
    })).rejects.toBeInstanceOf(CognitiveModelUnavailableError);
  });

  it("falha fechado quando provider devolve contrato de planejamento malformado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{not-json}" } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const model = new OpenAiCompatibleCognitiveModel(
      "https://models.example.test",
      "unit-test-token",
      "approved-model",
    );

    await expect(model.plan({
      question: "Explique",
      metricCatalog: [{ metricId: "incident.count", displayName: "Incidentes", description: "Incidentes governados" }],
      operationalContext: [],
    })).rejects.toBeInstanceOf(CognitiveModelContractError);
  });
});
