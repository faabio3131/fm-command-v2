import { and, asc, eq, sql } from "drizzle-orm";
import type { ReportFrequency } from "@/domain/reports/schedule";
import { db } from "@/infrastructure/db/client";
import { reports } from "@/infrastructure/db/report-schema";

export interface ReportDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly metricIds: readonly string[];
  readonly frequency: ReportFrequency;
  readonly hour: number;
  readonly weekday: number;
  readonly dayOfMonth: number;
  readonly enabled: boolean;
  readonly lastPeriodKey: string | null;
  readonly lastRunAt: Date | null;
  readonly createdAt: Date;
}

type Row = typeof reports.$inferSelect;
const def = (r: Row): ReportDefinition => ({
  id: r.id, tenantId: r.tenantId, name: r.name, metricIds: r.metricIds, frequency: r.frequency as ReportFrequency, hour: r.hour,
  weekday: r.weekday, dayOfMonth: r.dayOfMonth, enabled: r.enabled, lastPeriodKey: r.lastPeriodKey, lastRunAt: r.lastRunAt, createdAt: r.createdAt,
});

export const MAX_REPORTS_PER_TENANT = 20;

/** Leituras e escritas filtram pela empresa; a única consulta entre empresas é a lista de agendados para o agendador. */
export class PostgresReportRepository {
  async list(tenantId: string): Promise<readonly ReportDefinition[]> {
    return (await db.select().from(reports).where(eq(reports.tenantId, tenantId)).orderBy(asc(reports.createdAt))).map(def);
  }
  async get(tenantId: string, id: string): Promise<ReportDefinition | null> {
    const [row] = await db.select().from(reports).where(and(eq(reports.tenantId, tenantId), eq(reports.id, id))).limit(1);
    return row ? def(row) : null;
  }
  /** Falso quando a empresa já está no limite de relatórios (a contagem e a inserção são uma instrução só). */
  async create(input: Omit<ReportDefinition, "id" | "enabled" | "lastPeriodKey" | "lastRunAt" | "createdAt"> & { createdBy: string; createdAt: Date }): Promise<ReportDefinition | null> {
    const result = await db.execute(sql`
      insert into fmcc_report (tenant_id, name, metric_ids, frequency, hour, weekday, day_of_month, created_by, created_at)
      select ${input.tenantId}, ${input.name}, ${JSON.stringify(input.metricIds)}::jsonb, ${input.frequency}, ${input.hour}, ${input.weekday}, ${input.dayOfMonth}, ${input.createdBy}, ${input.createdAt}
      where (select count(*) from fmcc_report where tenant_id = ${input.tenantId}) < ${MAX_REPORTS_PER_TENANT}
      returning id`);
    const id = (result.rows[0] as { id: string } | undefined)?.id;
    return id ? this.get(input.tenantId, id) : null;
  }
  async setEnabled(tenantId: string, id: string, enabled: boolean): Promise<boolean> {
    return (await db.update(reports).set({ enabled }).where(and(eq(reports.tenantId, tenantId), eq(reports.id, id))).returning({ id: reports.id })).length > 0;
  }
  async remove(tenantId: string, id: string): Promise<boolean> {
    return (await db.delete(reports).where(and(eq(reports.tenantId, tenantId), eq(reports.id, id))).returning({ id: reports.id })).length > 0;
  }
  /** Agendador: relatórios ligados de todas as empresas. */
  async listEnabled(): Promise<readonly ReportDefinition[]> {
    return (await db.select().from(reports).where(eq(reports.enabled, true))).map(def);
  }
  /** Só avança a marca (nunca volta). Verdadeiro se esta chamada a avançou. */
  async markRan(tenantId: string, id: string, periodKey: string, at: Date): Promise<boolean> {
    const rows = await db.update(reports).set({ lastPeriodKey: periodKey, lastRunAt: at })
      .where(and(eq(reports.tenantId, tenantId), eq(reports.id, id), sql`(${reports.lastPeriodKey} is null or ${reports.lastPeriodKey} < ${periodKey})`))
      .returning({ id: reports.id });
    return rows.length > 0;
  }
  async touchRun(tenantId: string, id: string, at: Date): Promise<void> {
    await db.update(reports).set({ lastRunAt: at }).where(and(eq(reports.tenantId, tenantId), eq(reports.id, id)));
  }
}
