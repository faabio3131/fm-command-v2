import type { ChannelService } from "@/application/channels/channel-service";
import type { MetricService } from "@/application/metrics/metric-service";
import type { AlertMessageText } from "@/domain/channels/alert-message";
import { getMetricDefinition } from "@/domain/metrics/registry";
import { dueOccurrence, validateSchedule, type ReportSchedule } from "@/domain/reports/schedule";
import { toCsv, type ReportRow } from "@/domain/reports/snapshot";
import { PermissionDeniedError, requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import { createTranslator } from "@/i18n/translate";
import type { Locale } from "@/i18n/locales";
import { MAX_REPORTS_PER_TENANT, type PostgresReportRepository, type ReportDefinition } from "@/infrastructure/reports/postgres-report-repository";

export class ReportInputError extends Error {
  constructor(readonly field: string) { super(`report.input_invalid:${field}`); this.name = "ReportInputError"; }
}
export class ReportNotFoundError extends Error { constructor() { super("report.not_found"); this.name = "ReportNotFoundError"; } }
export class ReportLimitError extends Error { constructor() { super("report.limit_reached"); this.name = "ReportLimitError"; } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_METRICS = 12;

export interface ReportAudit {
  record(input: { tenantId: string; actorId: string; action: string; resourceType: string; resourceId: string | null; result: string; correlationId: string; metadata: Record<string, unknown> }): Promise<void>;
}

export interface ReportServiceDeps {
  readonly repository: Pick<PostgresReportRepository, "list" | "get" | "create" | "setEnabled" | "remove" | "listEnabled" | "markRan" | "touchRun">;
  readonly metrics: Pick<MetricService, "query" | "canReadCompanyLevel">;
  readonly channels: Pick<ChannelService, "notifyReport">;
  readonly audit: ReportAudit;
  /** Fuso e idioma da empresa (perfil). */
  readonly tenantProfile: (tenantId: string) => Promise<{ timeZone: string; locale: Locale }>;
  readonly now?: () => Date;
}

function format(value: string, unit: string, currency: string | null, locale: Locale): string {
  const amount = value as unknown as number; // só exibição: Intl aceita o texto decimal sem passar por ponto flutuante
  if (unit === "currency" && currency) return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  if (unit === "percent") return `${new Intl.NumberFormat(locale).format(amount)}%`;
  return new Intl.NumberFormat(locale).format(amount);
}

/** Relatórios: lê números só pelo MetricService (escopo de unidades), exporta CSV e envia pelos canais da empresa. */
export class ReportService {
  private readonly now: () => Date;
  constructor(private readonly deps: ReportServiceDeps) { this.now = deps.now ?? (() => new Date()); }

  async list(context: TenantContext) {
    requirePermission(context, "report:read");
    return this.deps.repository.list(context.tenantId);
  }

  async create(context: TenantContext, input: { name: unknown; metricIds: unknown; frequency: unknown; hour: unknown; weekday?: unknown; dayOfMonth?: unknown }): Promise<ReportDefinition> {
    requirePermission(context, "report:write");
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length === 0 || name.length > 80) throw new ReportInputError("name");
    const metricIds = this.validMetrics(input.metricIds);
    const schedule = validateSchedule({ frequency: input.frequency, hour: input.hour, weekday: input.weekday ?? 1, dayOfMonth: input.dayOfMonth ?? 1 });
    if (!schedule) throw new ReportInputError("schedule");
    const created = await this.deps.repository.create({ tenantId: context.tenantId, name, metricIds, ...schedule, createdBy: context.userId, createdAt: this.now() });
    if (!created) throw new ReportLimitError();
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "report.created", resourceType: "report", resourceId: created.id, result: "success", correlationId: context.correlationId, metadata: { metrics: metricIds.length, frequency: schedule.frequency } });
    return created;
  }

  async setEnabled(context: TenantContext, id: string, enabled: boolean): Promise<void> {
    requirePermission(context, "report:write");
    if (!UUID.test(id) || !(await this.deps.repository.setEnabled(context.tenantId, id, enabled))) throw new ReportNotFoundError();
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "report.toggled", resourceType: "report", resourceId: id, result: "success", correlationId: context.correlationId, metadata: { enabled } });
  }

  async remove(context: TenantContext, id: string): Promise<void> {
    requirePermission(context, "report:write");
    if (!UUID.test(id) || !(await this.deps.repository.remove(context.tenantId, id))) throw new ReportNotFoundError();
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "report.removed", resourceType: "report", resourceId: id, result: "success", correlationId: context.correlationId, metadata: {} });
  }

  private validMetrics(raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_METRICS) throw new ReportInputError("metricIds");
    const ids = [...new Set(raw)];
    if (!ids.every((id): id is string => typeof id === "string" && Boolean(getMetricDefinition(id)))) throw new ReportInputError("metricIds");
    return ids;
  }

  /** Números atuais das métricas pedidas, no nível da empresa. Quem só enxerga algumas filiais não recebe dado da empresa. */
  async snapshot(context: TenantContext, metricIds: readonly string[]): Promise<readonly ReportRow[]> {
    requirePermission(context, "metric:read");
    if (!(await this.deps.metrics.canReadCompanyLevel(context))) throw new PermissionDeniedError("metric:read");
    const rows: ReportRow[] = [];
    for (const metricId of metricIds) {
      const definition = getMetricDefinition(metricId);
      if (!definition) throw new ReportInputError("metricIds");
      const view = await this.deps.metrics.query(context, metricId);
      rows.push({
        metricId, name: definition.displayName, value: view?.value ?? null, unit: view?.unit ?? definition.unit, currency: view?.currency ?? null,
        freshness: view?.freshnessStatus ?? "unavailable", quality: view?.qualityStatus ?? "missing", computedAt: view?.computedAt ?? null,
      });
    }
    return rows;
  }

  async exportCsv(context: TenantContext, metricIds: unknown): Promise<string> {
    requirePermission(context, "report:read");
    const ids = this.validMetrics(metricIds);
    const csv = toCsv(await this.snapshot(context, ids));
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "report.exported", resourceType: "report_export", resourceId: null, result: "success", correlationId: context.correlationId, metadata: { metrics: ids.length, format: "csv" } });
    return csv;
  }

  /** Texto da mensagem: nome da métrica e valor no idioma da empresa; sem valor, "indisponível". */
  async buildText(context: TenantContext, report: ReportDefinition, locale: Locale, nameOf: (locale: Locale, metricId: string, fallback: string) => string): Promise<AlertMessageText> {
    const tr = createTranslator(locale);
    const rows = await this.snapshot(context, report.metricIds);
    const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(this.now());
    const lines = rows.map((r) => tr.t("report.line", { metric: nameOf(locale, r.metricId, r.name), value: r.value === null ? tr.t("report.unavailable") : format(r.value, r.unit, r.currency, locale) }));
    return {
      subject: tr.t("report.subject", { name: report.name }),
      body: [tr.t("report.body.intro", { name: report.name, date }), "", ...lines, "", tr.t("report.body.footer")].join("\n"),
    };
  }

  /** "Enviar agora": cada pedido é um envio novo (não conta como o período agendado). */
  async sendNow(context: TenantContext, id: string, nonce: string, nameOf: (locale: Locale, metricId: string, fallback: string) => string) {
    requirePermission(context, "report:write");
    const report = UUID.test(id) ? await this.deps.repository.get(context.tenantId, id) : null;
    if (!report) throw new ReportNotFoundError();
    const profile = await this.deps.tenantProfile(context.tenantId);
    const text = await this.buildText(context, report, profile.locale, nameOf);
    const result = await this.deps.channels.notifyReport({ tenantId: context.tenantId, reportId: report.id, periodKey: `manual:${nonce}` }, text);
    await this.deps.repository.touchRun(context.tenantId, report.id, this.now());
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "report.sent_now", resourceType: "report", resourceId: report.id, result: "success", correlationId: context.correlationId, metadata: { queued: result.queued } });
    return result;
  }

  /**
   * Rodada do agendador (chamada de fora, por exemplo a cada 15 minutos). Para cada relatório ligado, vê se há ocorrência vencida no
   * fuso da empresa e a envia. Repetir a rodada não reenvia: o envio é idempotente por (relatório, período) e a marca só avança.
   */
  async runDue(nameOf: (locale: Locale, metricId: string, fallback: string) => string, correlationId: string): Promise<{ checked: number; sent: number; failed: number }> {
    const now = this.now();
    const counts = { checked: 0, sent: 0, failed: 0 };
    for (const report of await this.deps.repository.listEnabled()) {
      counts.checked += 1;
      try {
        const { timeZone, locale } = await this.deps.tenantProfile(report.tenantId);
        const schedule: ReportSchedule = { frequency: report.frequency, hour: report.hour, weekday: report.weekday, dayOfMonth: report.dayOfMonth };
        const due = dueOccurrence(schedule, now, timeZone, report.lastPeriodKey, report.createdAt);
        if (!due) continue;
        const context: TenantContext = { tenantId: report.tenantId, userId: "system:fmcc-report-scheduler", role: "admin", correlationId: `${correlationId}:${report.id}` };
        const text = await this.buildText(context, report, locale, nameOf);
        await this.deps.channels.notifyReport({ tenantId: report.tenantId, reportId: report.id, periodKey: due.key }, text);
        if (await this.deps.repository.markRan(report.tenantId, report.id, due.key, now)) {
          counts.sent += 1;
          await this.deps.audit.record({ tenantId: report.tenantId, actorId: "system:fmcc-report-scheduler", action: "report.scheduled_run", resourceType: "report", resourceId: report.id, result: "success", correlationId: context.correlationId, metadata: { periodKey: due.key } });
        }
      } catch {
        counts.failed += 1; // um relatório com problema não impede os outros
      }
    }
    return counts;
  }
}

export { MAX_REPORTS_PER_TENANT };
