import { buildAlertService } from "@/application/alerts/alert-composition";
import type { AlertService } from "@/application/alerts/alert-service";
import type { TenantContext } from "@/domain/security/tenant-context";
import { PostgresAlertAutomationRepository } from "@/infrastructure/alerts/postgres-alert-automation-repository";

export interface AlertAutomationRunResult {
  readonly status: "completed" | "duplicate";
  readonly runId: string;
  readonly tenants: number;
  readonly rulesEvaluated: number;
  readonly occurrencesCreated: number;
  readonly unavailable: number;
  readonly clear: number;
  readonly incompatible: number;
  readonly failures: number;
}

export class AlertAutomationService {
  constructor(
    private readonly runs = new PostgresAlertAutomationRepository(),
    private readonly alerts: AlertService = buildAlertService(),
  ) {}

  async run(input: {
    runId: string;
    correlationId?: string;
  }): Promise<AlertAutomationRunResult> {
    const runId = input.runId.trim();
    if (!/^[A-Za-z0-9._:-]{8,192}$/.test(runId)) {
      throw new Error("automation.run_id_invalid");
    }
    const correlationId =
      input.correlationId?.trim() || this.runs.newCorrelationId();

    const state = await this.runs.beginRun({ runId, correlationId });
    if (state === "duplicate") {
      return {
        status: "duplicate",
        runId,
        tenants: 0,
        rulesEvaluated: 0,
        occurrencesCreated: 0,
        unavailable: 0,
        clear: 0,
        incompatible: 0,
        failures: 0,
      };
    }

    try {
      const tenantIds = await this.runs.listTenantIdsWithRules();
      let rulesEvaluated = 0;
      let occurrencesCreated = 0;
      let unavailable = 0;
      let clear = 0;
      let incompatible = 0;
      let failures = 0;

      for (const tenantId of tenantIds) {
        const context: TenantContext = {
          tenantId,
          userId: "system:fmcc-alert-scheduler",
          role: "admin",
          correlationId: `${correlationId}:${tenantId}`,
        };

        try {
          const overview = await this.alerts.overview(context);
          const activeRules = overview.rules.filter(
            (rule) => rule.enabled && !rule.archived,
          );

          for (const rule of activeRules) {
            rulesEvaluated += 1;
            try {
              const result = await this.alerts.evaluate(context, rule.id);
              if (result.created) occurrencesCreated += 1;
              if (result.evaluation.status === "unavailable") unavailable += 1;
              else if (result.evaluation.status === "clear") clear += 1;
              else if (result.evaluation.status === "incompatible") incompatible += 1;
            } catch {
              failures += 1;
            }
          }
        } catch {
          failures += 1;
        }
      }

      await this.runs.completeRun({
        runId,
        correlationId,
        tenants: tenantIds.length,
        rulesEvaluated,
        occurrencesCreated,
        unavailable,
        clear,
        incompatible,
        failures,
      });

      return {
        status: "completed",
        runId,
        tenants: tenantIds.length,
        rulesEvaluated,
        occurrencesCreated,
        unavailable,
        clear,
        incompatible,
        failures,
      };
    } catch (error) {
      try {
        await this.runs.failRun({
          runId,
          correlationId,
          errorCode: error instanceof Error ? error.name : "UnknownError",
        });
      } catch {
        // Preserve the original execution failure.
      }
      throw error;
    }
  }
}
