import { channelAudit, buildChannelService } from "@/application/channels/channel-composition";
import { AgentService, type WorkResultReader } from "@/application/agents/agent-service";
import { buildReportService, metricNameFor, tenantProfile } from "@/application/reports/report-composition";
import { buildSectorService } from "@/application/sectors/sector-composition";
import type { AlertMessageText } from "@/domain/channels/alert-message";
import { METRIC_REGISTRY } from "@/domain/metrics/registry";
import { PostgresAgentRepository } from "@/infrastructure/agents/postgres-agent-repository";
import { pool } from "@/infrastructure/db/client";
import { PostgresWorkQueue } from "@/infrastructure/core/postgres-work-queue";

/** Quantas métricas entram no resumo (as com dado primeiro; o restante só aparece se sobrar lugar). */
const MAX_LINES = 15;

export const workReader: WorkResultReader = {
  async read(tenantId, workItemId) {
    const item = await pool.query<{ state: string; result: { text?: unknown } | null; last_error: string | null }>(
      "SELECT state, result, last_error FROM fmcc_work_item WHERE tenant_id=$1 AND id=$2", [tenantId, workItemId]);
    const row = item.rows[0];
    if (!row) return null;
    // Custo real: tudo que o provedor cobrou por esta tarefa (todas as tentativas), no registro de uso de IA.
    const usage = await pool.query<{ cost: string; currencies: string[] }>(
      "SELECT coalesce(sum(cost_micro_minor),0)::text AS cost, array_agg(DISTINCT currency) AS currencies FROM fmcc_ai_usage WHERE tenant_id=$1 AND task_id=$2", [tenantId, workItemId]);
    const currencies = (usage.rows[0]?.currencies ?? []).filter(Boolean);
    return {
      state: row.state, text: typeof row.result?.text === "string" ? row.result.text : null, lastError: row.last_error,
      costMicroMinor: Number(usage.rows[0]?.cost ?? 0),
      // Duas moedas na mesma tarefa não se comparam com o teto: marca 'XXX', que o orçamento trata como moeda diferente.
      currency: currencies.length === 0 ? null : currencies.length === 1 ? currencies[0]! : "XXX",
    };
  },
};

export function buildAgentService(): AgentService {
  const reports = buildReportService();
  const sectors = buildSectorService();
  return new AgentService({
    repository: new PostgresAgentRepository(),
    queue: new PostgresWorkQueue(pool),
    work: workReader,
    channels: buildChannelService(),
    tenantProfile,
    audit: channelAudit,
    numberLines: async (context, locale) => {
      const visible = await sectors.visibleMetricIds(context.tenantId);
      const ids = METRIC_REGISTRY.filter((m) => visible.has(m.metricId)).map((m) => m.metricId);
      const rows = await reports.snapshot(context, ids);
      const withData = rows.filter((r) => r.value !== null).map((r) => r.metricId);
      const without = rows.filter((r) => r.value === null).map((r) => r.metricId);
      return reports.numberLines(context, [...withData, ...without].slice(0, MAX_LINES), locale, metricNameFor);
    },
  });
}

/** Refaz o texto para reenvio de um rascunho: é sempre o texto final aprovado (nunca o do modelo). */
export async function rebuildAgentDraftText(tenantId: string, draftId: string): Promise<AlertMessageText | null> {
  const draft = await new PostgresAgentRepository().get(tenantId, draftId);
  if (!draft || (draft.status !== "approved" && draft.status !== "sent") || !draft.finalSubject || !draft.finalBody) return null;
  return { subject: draft.finalSubject, body: draft.finalBody };
}
