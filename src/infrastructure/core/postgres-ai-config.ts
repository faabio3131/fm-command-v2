import type { Pool } from "pg";
import type { ProviderConfig } from "@/domain/core/ai-provider";
import { validateProviderConfig } from "@/domain/core/ai-provider";
import { validateRows, type RoutingRow } from "@/domain/core/routing-policy";
import type { AiConfigSnapshot, AiConfigSource, UsageRecord } from "@/application/core/provider-router";

/** Le a politica de provedores do banco e grava o uso. Provedor desabilitado ou com configuracao invalida nao entra. */
export class PostgresAiConfig implements AiConfigSource {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async load(): Promise<AiConfigSnapshot> {
    const [prov, routes, pol] = await Promise.all([
      this.pool.query(`SELECT * FROM fmcc_ai_provider WHERE enabled`),
      this.pool.query(`SELECT task_type, tenant_id, provider_id, role, weight, max_concurrent FROM fmcc_ai_route`),
      this.pool.query(`SELECT tenant_id, allowed_providers FROM fmcc_ai_tenant_policy`),
    ]);
    const providers: ProviderConfig[] = [];
    for (const r of prov.rows) {
      const cfg: ProviderConfig = {
        id: r.id, kind: r.kind, baseUrl: r.base_url, model: r.model, secretRef: r.secret_ref, timeoutMs: r.timeout_ms,
        pricing: { currency: r.currency, inputMinorPerMillion: r.input_minor_per_million, outputMinorPerMillion: r.output_minor_per_million },
      };
      if (validateProviderConfig(cfg, { allowLocal: process.env.FMCC_AI_ALLOW_LOCAL_PROVIDERS === "1" }).length === 0) providers.push(cfg);
    }
    const ids = new Set(providers.map((p) => p.id));
    const rows: RoutingRow[] = routes.rows
      .filter((r) => ids.has(r.provider_id))
      .map((r) => ({ taskType: r.task_type, tenantId: r.tenant_id, providerId: r.provider_id, role: r.role, weight: r.weight, maxConcurrent: r.max_concurrent }));
    const valid = validateRows(rows);
    if (!valid.ok) throw new Error(`ai.routing_table_invalid:${valid.errors.join(",")}`);
    const allowedByTenant: Record<string, readonly string[]> = {};
    for (const p of pol.rows) allowedByTenant[p.tenant_id] = p.allowed_providers;
    return { providers, rows, allowedByTenant };
  }

  async recordUsage(u: UsageRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO fmcc_ai_usage(tenant_id,unit_id,task_id,attempt,task_type,provider_id,model,tokens_in,tokens_out,estimated,cost_micro_minor,currency,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (task_id, attempt, provider_id) DO NOTHING`,
      [u.tenantId, u.unitId, u.taskId, u.attempt, u.taskType, u.providerId, u.model, u.tokensIn, u.tokensOut, u.estimated, u.costMicroMinor, u.currency, u.occurredAt]);
  }
}
