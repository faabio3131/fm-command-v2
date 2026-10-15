import { describe, expect, it } from "vitest";
import { AlertAutomationService } from "@/application/alerts/alert-automation-service";
import type { AlertService } from "@/application/alerts/alert-service";

class MemoryRuns {
  started = new Set<string>();
  completed: Record<string, unknown>[] = [];
  failed: Record<string, unknown>[] = [];
  failListing = false;

  async listTenantIdsWithRules() {
    if (this.failListing) throw new Error("database unavailable");
    return ["tenant-a", "tenant-b"];
  }

  async beginRun(input: { runId: string }) {
    if (this.started.has(input.runId)) return "duplicate" as const;
    this.started.add(input.runId);
    return "started" as const;
  }

  async completeRun(input: Record<string, unknown>) {
    this.completed.push(input);
  }

  async failRun(input: Record<string, unknown>) {
    this.failed.push(input);
  }

  newCorrelationId() {
    return "automation-test-correlation";
  }
}

function fakeAlertService() {
  const evaluated: { tenantId: string; ruleId: string }[] = [];
  const service = {
    async overview(context: { tenantId: string }) {
      if (context.tenantId === "tenant-a") {
        return {
          rules: [
            { id: "active-a", enabled: true, archived: false },
            { id: "disabled-a", enabled: false, archived: false },
            { id: "archived-a", enabled: false, archived: true },
          ],
          occurrences: [],
        };
      }
      return {
        rules: [{ id: "active-b", enabled: true, archived: false }],
        occurrences: [],
      };
    },
    async evaluate(context: { tenantId: string }, ruleId: string) {
      evaluated.push({ tenantId: context.tenantId, ruleId });
      if (ruleId === "active-a") {
        return {
          created: false,
          evaluation: { status: "unavailable" as const },
        };
      }
      return {
        created: true,
        evaluation: { status: "triggered" as const },
      };
    },
  };
  return { service: service as unknown as AlertService, evaluated };
}

describe("automação proativa de alertas", () => {
  it("avalia somente regras ativas e preserva unavailable sem ocorrência falsa", async () => {
    const runs = new MemoryRuns();
    const alerts = fakeAlertService();
    const service = new AlertAutomationService(
      runs as never,
      alerts.service,
    );

    const result = await service.run({
      runId: "run-automation-0001",
      correlationId: "corr-automation-0001",
    });

    expect(result).toMatchObject({
      status: "completed",
      tenants: 2,
      rulesEvaluated: 2,
      occurrencesCreated: 1,
      unavailable: 1,
      clear: 0,
      incompatible: 0,
      failures: 0,
    });
    expect(alerts.evaluated).toEqual([
      { tenantId: "tenant-a", ruleId: "active-a" },
      { tenantId: "tenant-b", ruleId: "active-b" },
    ]);
    expect(runs.completed).toHaveLength(1);
  });

  it("trata o mesmo runId como duplicado sem reavaliar regras", async () => {
    const runs = new MemoryRuns();
    const alerts = fakeAlertService();
    const service = new AlertAutomationService(
      runs as never,
      alerts.service,
    );

    await service.run({ runId: "run-automation-0002" });
    const duplicate = await service.run({ runId: "run-automation-0002" });

    expect(duplicate.status).toBe("duplicate");
    expect(alerts.evaluated).toHaveLength(2);
  });

  it("registra falha terminal quando a execução quebra fora da avaliação por regra", async () => {
    const runs = new MemoryRuns();
    runs.failListing = true;
    const alerts = fakeAlertService();
    const service = new AlertAutomationService(
      runs as never,
      alerts.service,
    );

    await expect(
      service.run({
        runId: "run-automation-failure-0001",
        correlationId: "corr-automation-failure-0001",
      }),
    ).rejects.toThrow("database unavailable");

    expect(runs.failed).toHaveLength(1);
    expect(runs.failed[0]).toMatchObject({
      runId: "run-automation-failure-0001",
      errorCode: "Error",
    });
  });

  it("recusa runId fraco ou inválido", async () => {
    const runs = new MemoryRuns();
    const alerts = fakeAlertService();
    const service = new AlertAutomationService(
      runs as never,
      alerts.service,
    );

    await expect(service.run({ runId: "x" })).rejects.toThrow(
      "automation.run_id_invalid",
    );
  });
});
