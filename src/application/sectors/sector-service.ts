import type { ReportService } from "@/application/reports/report-service";
import { BASE_METRIC_REGISTRY } from "@/domain/metrics/registry";
import { getSectorPack, SECTOR_PACKS } from "@/domain/sectors/catalog";
import type { SectorPack } from "@/domain/sectors/sector-pack";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import type { Locale } from "@/i18n/locales";
import type { PostgresSectorRepository } from "@/infrastructure/sectors/postgres-sector-repository";

export class SectorPackNotFoundError extends Error { constructor() { super("sector.pack_not_found"); this.name = "SectorPackNotFoundError"; } }
export class SectorPackNotEnabledError extends Error { constructor() { super("sector.pack_not_enabled"); this.name = "SectorPackNotEnabledError"; } }

export interface SectorAudit {
  record(input: { tenantId: string; actorId: string; action: string; resourceType: string; resourceId: string | null; result: string; correlationId: string; metadata: Record<string, unknown> }): Promise<void>;
}

export interface SectorServiceDeps {
  readonly repository: Pick<PostgresSectorRepository, "listEnabled" | "enable" | "disable">;
  readonly reports: Pick<ReportService, "create" | "list">;
  readonly audit: SectorAudit;
}

/** Liga e desliga pacotes por setor por empresa e diz quais métricas cada empresa deve ver. */
export class SectorService {
  constructor(private readonly deps: SectorServiceDeps) {}

  async overview(context: TenantContext): Promise<readonly { pack: SectorPack; enabled: boolean }[]> {
    requirePermission(context, "sector:read");
    const enabled = new Set((await this.deps.repository.listEnabled(context.tenantId)).map((e) => e.packId));
    return SECTOR_PACKS.map((pack) => ({ pack, enabled: enabled.has(pack.id) }));
  }

  async setEnabled(context: TenantContext, packId: string, enabled: boolean): Promise<void> {
    requirePermission(context, "sector:write");
    const pack = getSectorPack(packId);
    if (!pack) throw new SectorPackNotFoundError();
    const changed = enabled
      ? await this.deps.repository.enable(context.tenantId, pack.id, pack.version, context.userId)
      : await this.deps.repository.disable(context.tenantId, pack.id);
    if (changed) {
      await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: enabled ? "sector.pack.enabled" : "sector.pack.disabled", resourceType: "sector_pack", resourceId: pack.id, result: "success", correlationId: context.correlationId, metadata: { version: pack.version } });
    }
  }

  /** Métricas que a empresa deve ver nas telas e seletores: as da plataforma e as dos pacotes que ligou. */
  async visibleMetricIds(tenantId: string): Promise<ReadonlySet<string>> {
    const enabled = new Set((await this.deps.repository.listEnabled(tenantId)).map((e) => e.packId));
    const ids = new Set(BASE_METRIC_REGISTRY.map((m) => m.metricId));
    for (const pack of SECTOR_PACKS) if (enabled.has(pack.id)) for (const m of pack.metrics) ids.add(m.id);
    return ids;
  }

  async isEnabled(tenantId: string, packId: string): Promise<boolean> {
    return (await this.deps.repository.listEnabled(tenantId)).some((e) => e.packId === packId);
  }

  /** Cria o relatório sugerido do pacote (uma vez: se já existe um com o mesmo nome, não duplica). */
  async createSuggestedReport(context: TenantContext, packId: string, locale: Locale): Promise<{ created: boolean }> {
    requirePermission(context, "sector:write");
    const pack = getSectorPack(packId);
    if (!pack) throw new SectorPackNotFoundError();
    if (!(await this.isEnabled(context.tenantId, pack.id))) throw new SectorPackNotEnabledError();
    const suggestion = pack.suggestedReport;
    const name = suggestion.name[locale];
    if ((await this.deps.reports.list(context)).some((r) => r.name === name)) return { created: false };
    await this.deps.reports.create(context, { name, metricIds: suggestion.metricIds, frequency: suggestion.frequency, hour: suggestion.hour });
    return { created: true };
  }
}
