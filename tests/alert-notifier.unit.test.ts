import { describe, expect, it } from "vitest";
import { AlertService, type AlertNotifier } from "@/application/alerts/alert-service";
import { alertText } from "@/application/channels/channel-composition";
import type { MetricService, MetricView } from "@/application/metrics/metric-service";
import type { AlertOccurrence, AlertRepository, AlertRule } from "@/domain/alerts/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

const context: TenantContext = { tenantId: "tenant-n", userId: "user-n", role: "owner", correlationId: "corr-n" };
const rule: AlertRule = { id: "rule-n", tenantId: "tenant-n", metricId: "incident.count", operator: "gte", threshold: "10", severity: "critical", enabled: true, archived: false, createdBy: "u", createdAt: new Date() };
const view = { metricId: "incident.count", metricVersion: 1, value: "12", unit: "count", periodStart: new Date(), periodEnd: new Date(), computedAt: new Date(), freshnessStatus: "fresh", qualityStatus: "verified", sourceAuthority: "t", provenanceRefs: ["f1"] } as MetricView;

function repo(): AlertRepository {
  const seen = new Set<string>();
  return {
    async findRule() { return rule; },
    async recordOccurrence(o: AlertOccurrence) { const created = !seen.has(o.fingerprint); seen.add(o.fingerprint); return { occurrence: o, created }; },
  } as unknown as AlertRepository;
}
const metrics = { async query() { return view; } } as unknown as MetricService;

describe("alerta gerado avisa os canais", () => {
  it("avisa só quando a ocorrência é nova", async () => {
    const calls: string[] = [];
    const notifier: AlertNotifier = { async onOccurrence(o) { calls.push(`${o.id}:${o.severity}`); } };
    const service = new AlertService(repo(), metrics, undefined, notifier);
    await service.evaluate(context, "rule-n");
    await service.evaluate(context, "rule-n");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/:critical$/);
  });
  it("falha do notificador não derruba a avaliação", async () => {
    const notifier: AlertNotifier = { async onOccurrence() { throw new Error("canal fora do ar"); } };
    const service = new AlertService(repo(), metrics, undefined, notifier);
    await expect(service.evaluate(context, "rule-n")).resolves.toMatchObject({ created: true });
  });
  it("texto da mensagem sai no idioma da empresa", () => {
    const o = { metricId: "trial.starts.count", severity: "critical", observedValue: "12", operator: "gte", threshold: "10" };
    expect(alertText("pt-BR", o).subject).toContain("Testes gratuitos iniciados");
    expect(alertText("en-US", o).subject).toContain("Free trials started");
    expect(alertText("en-US", { ...o, metricId: "desconhecida" }).subject).toContain("desconhecida");
  });
});
