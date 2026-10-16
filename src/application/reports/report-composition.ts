import { buildChannelService, channelAudit } from "@/application/channels/channel-composition";
import { ReportService } from "@/application/reports/report-service";
import { createMetricRecomputeService, createMetricService } from "@/application/metrics/metric-composition";
import type { AlertMessageText } from "@/domain/channels/alert-message";
import type { Locale } from "@/i18n/locales";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { PostgresProfileRepository } from "@/infrastructure/i18n/postgres-profile-repository";
import { PostgresReportRepository } from "@/infrastructure/reports/postgres-report-repository";
import { createLabels } from "@/presentation/labels";

export const metricNameFor = (locale: Locale, metricId: string, fallback: string) => createLabels(locale).metricName(metricId, fallback);

export async function tenantProfile(tenantId: string): Promise<{ timeZone: string; locale: Locale }> {
  try {
    const profile = await new PostgresProfileRepository().getOrgProfile(tenantId);
    return { timeZone: profile?.timezone ?? "UTC", locale: profile?.defaultLocale ?? DEFAULT_LOCALE };
  } catch { return { timeZone: "UTC", locale: DEFAULT_LOCALE }; }
}

export function buildReportService(): ReportService {
  return new ReportService({
    repository: new PostgresReportRepository(), metrics: createMetricService(), channels: buildChannelService(),
    audit: channelAudit, tenantProfile,
    refreshMetrics: (tenantId, correlationId) => createMetricRecomputeService().recomputeTenant(tenantId, correlationId),
  });
}

/** Refaz o texto de um relatório para reenvio (os números são os de agora; o recibo guarda só o resumo do conteúdo). */
export async function rebuildReportText(tenantId: string, reportId: string): Promise<AlertMessageText | null> {
  const service = buildReportService();
  const repository = new PostgresReportRepository();
  const report = await repository.get(tenantId, reportId);
  if (!report) return null;
  const { locale } = await tenantProfile(tenantId);
  const context = { tenantId, userId: "system:fmcc-report-scheduler", role: "admin" as const, correlationId: `rebuild:${reportId}` };
  try { return await service.buildText(context, report, locale, metricNameFor); } catch { return null; }
}
