import type { MetricService } from "@/application/metrics/metric-service";
import { PERIOD_KINDS, resolvePeriod } from "@/domain/metrics/period";
import { METRIC_REGISTRY, type MetricDefinition } from "@/domain/metrics/registry";
import type { TenantContext } from "@/domain/security/tenant-context";

export interface FactScope { factType: string; productId: string | null; unitId: string | null }

export interface MetricRecomputeDeps {
  readonly metrics: Pick<MetricService, "recompute">;
  readonly factScopes: (tenantId: string) => Promise<readonly FactScope[]>;
  readonly tenantIds: () => Promise<readonly string[]>;
  readonly timeZone: (tenantId: string) => Promise<string>;
  readonly definitions?: readonly MetricDefinition[];
  readonly now?: () => Date;
}

export interface RecomputeResult { readonly computed: number; readonly failed: number }

/**
 * Da fonte ao número: transforma os fatos que os conectores gravaram em valores de métrica. Calcula só onde há fato (tipo, produto,
 * unidade), não regrava valor igual ao último, e calcula as métricas de período para mês corrente, mês anterior, trimestre e ano (calendário e fuso da empresa). É a peça que faltava
 * entre a sincronização e as telas, os alertas e os relatórios.
 */
export class MetricRecomputeService {
  private readonly now: () => Date;
  constructor(private readonly deps: MetricRecomputeDeps) { this.now = deps.now ?? (() => new Date()); }

  async recomputeTenant(tenantId: string, correlationId: string): Promise<RecomputeResult> {
    const now = this.now();
    const context: TenantContext = { tenantId, userId: "system:fmcc-metric-recompute", role: "admin", correlationId };
    const [scopes, timeZone] = await Promise.all([this.deps.factScopes(tenantId), this.deps.timeZone(tenantId)]);
    const periods = PERIOD_KINDS.map((kind) => resolvePeriod(kind, now, timeZone));
    let computed = 0;
    let failed = 0;
    for (const definition of this.deps.definitions ?? METRIC_REGISTRY) {
      for (const scope of scopes) {
        if (scope.factType !== definition.factType) continue;
        // Posição (as_of) não tem período: um valor só. Métrica de período é calculada para cada período escolhível.
        const targets = definition.grain === "as_of" ? [{ asOf: now }] : periods.map((p) => ({ periodStart: p.periodStart, periodEnd: p.periodEnd, periodKind: p.kind }));
        for (const target of targets) {
          try {
            await this.deps.metrics.recompute(context, {
              metricId: definition.metricId, productId: scope.productId ?? undefined, unitId: scope.unitId ?? undefined, ...target, skipIfUnchanged: true,
            });
            computed += 1;
          } catch {
            failed += 1; // ex.: duas moedas na mesma soma; o valor anterior continua e a falha aparece na contagem
          }
        }
      }
    }
    return { computed, failed };
  }

  /** Rodada agendada: todas as empresas com fatos. Uma empresa com problema não impede as outras. */
  async recomputeAll(correlationId: string): Promise<{ tenants: number; computed: number; failed: number }> {
    const tenants = await this.deps.tenantIds();
    let computed = 0;
    let failed = 0;
    for (const tenantId of tenants) {
      try {
        const r = await this.recomputeTenant(tenantId, `${correlationId}:${tenantId}`);
        computed += r.computed; failed += r.failed;
      } catch { failed += 1; }
    }
    return { tenants: tenants.length, computed, failed };
  }
}
