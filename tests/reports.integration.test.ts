import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ChannelService, type ChannelAudit, type CredentialWriter } from "@/application/channels/channel-service";
import { ReportInputError, ReportLimitError, ReportNotFoundError, ReportService } from "@/application/reports/report-service";
import type { MetricView } from "@/application/metrics/metric-service";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";
import { PostgresChannelRepository } from "@/infrastructure/channels/postgres-channel-repository";
import { defaultChannelRegistry } from "@/infrastructure/channels/channel-provider-registry";
import type { SimulatedChannelProvider } from "@/infrastructure/channels/simulated-channel-provider";
import { db } from "@/infrastructure/db/client";
import { channelConfigs, channelDeliveries, channelRecipients } from "@/infrastructure/db/channel-schema";
import { reports } from "@/infrastructure/db/report-schema";
import { MAX_REPORTS_PER_TENANT, PostgresReportRepository } from "@/infrastructure/reports/postgres-report-repository";

const A = "rep-it-a";
const B = "rep-it-b";
const ctx = (tenantId: string, role: TenantContext["role"] = "admin"): TenantContext => ({ tenantId, userId: "user-1", role, correlationId: "corr-1" });
const nameOf = (_l: string, _id: string, fallback: string) => fallback;

let clock = new Date("2026-10-16T12:00:00Z"); // 09:00 em São Paulo
let companyLevel = true;
const auditLog: { action: string; metadata: Record<string, unknown> }[] = [];
const values: Record<string, string | null> = { "revenue.cash_collected": "1000.50", "trial.starts.count": null };

function build() {
  const registry = defaultChannelRegistry({ FMCC_CHANNEL_SIMULATED: "1" });
  const audit: ChannelAudit = { async record(i) { auditLog.push({ action: i.action, metadata: i.metadata }); } };
  const channels = new ChannelService({
    repository: new PostgresChannelRepository(), registry, audit, now: () => clock,
    credentials: { async save() {}, async resolve() { throw new Error("sem cofre"); } } as unknown as CredentialWriter,
  });
  const metrics = {
    async canReadCompanyLevel() { return companyLevel; },
    async query(_c: TenantContext, metricId: string): Promise<MetricView | null> {
      const value = values[metricId];
      if (value === undefined || value === null) return null;
      return { metricId, metricVersion: 1, value, unit: metricId.startsWith("revenue") ? "currency" : "count", currency: metricId.startsWith("revenue") ? "BRL" : undefined, computedAt: clock, freshnessStatus: "fresh", qualityStatus: "verified", sourceAuthority: "t", provenanceRefs: [] };
    },
  };
  const service = new ReportService({
    repository: new PostgresReportRepository(), metrics, channels, audit, now: () => clock,
    tenantProfile: async () => ({ timeZone: "America/Sao_Paulo", locale: "pt-BR" }),
  });
  const provider = registry.get("email", "simulated_email") as SimulatedChannelProvider;
  return { service, channels, provider };
}

async function clean() {
  for (const t of [A, B]) {
    await db.delete(channelDeliveries).where(eq(channelDeliveries.tenantId, t));
    await db.delete(channelRecipients).where(eq(channelRecipients.tenantId, t));
    await db.delete(channelConfigs).where(eq(channelConfigs.tenantId, t));
    await db.delete(reports).where(eq(reports.tenantId, t));
  }
}
beforeEach(async () => { clock = new Date("2026-10-16T12:00:00Z"); companyLevel = true; auditLog.length = 0; await clean(); });
afterAll(clean);

async function withChannel(tenant: string, channels: ChannelService, address = "ana@empresa.com") {
  await channels.saveConfig(ctx(tenant), { kind: "email", providerId: "simulated_email", sender: "r@fm.test", enabled: true, minSeverity: "critical" });
  await channels.addRecipient(ctx(tenant), { kind: "email", address });
}
/** Cria o relatório "ontem" (relatório novo só envia ocorrências posteriores à criação) e volta o relógio para hoje. */
async function createYesterday(service: ReportService, tenant: string, data: Parameters<ReportService["create"]>[1], hoursBack = 24) {
  const today = clock;
  clock = new Date(today.getTime() - hoursBack * 3_600_000);
  try { return await service.create(ctx(tenant), data); } finally { clock = today; }
}
const input = { name: "Diário", metricIds: ["revenue.cash_collected", "trial.starts.count"], frequency: "daily", hour: 8 };

describe("relatórios: definição e permissões", () => {
  it("analista lê e não cria; viewer não vê; validação de campos", async () => {
    const { service } = build();
    await expect(service.create(ctx(A, "analyst"), input)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.list(ctx(A, "analyst"))).resolves.toEqual([]);
    await expect(service.list(ctx(A, "viewer"))).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.create(ctx(A), { ...input, name: " " })).rejects.toBeInstanceOf(ReportInputError);
    await expect(service.create(ctx(A), { ...input, metricIds: [] })).rejects.toBeInstanceOf(ReportInputError);
    await expect(service.create(ctx(A), { ...input, metricIds: ["nao.existe"] })).rejects.toBeInstanceOf(ReportInputError);
    await expect(service.create(ctx(A), { ...input, hour: 30 })).rejects.toBeInstanceOf(ReportInputError);
    await expect(service.create(ctx(A), { ...input, frequency: "hourly" })).rejects.toBeInstanceOf(ReportInputError);
  });
  it("limite por empresa, isolamento e remoção", async () => {
    const { service } = build();
    for (let i = 0; i < MAX_REPORTS_PER_TENANT; i += 1) await service.create(ctx(A), { ...input, name: `R${i}` });
    await expect(service.create(ctx(A), input)).rejects.toBeInstanceOf(ReportLimitError);
    expect(await service.list(ctx(B))).toHaveLength(0);
    const [first] = await service.list(ctx(A));
    await expect(service.remove(ctx(B), first.id)).rejects.toBeInstanceOf(ReportNotFoundError);
    await expect(service.remove(ctx(A), "nao-uuid")).rejects.toBeInstanceOf(ReportNotFoundError);
    await service.remove(ctx(A), first.id);
    expect(await service.list(ctx(A))).toHaveLength(MAX_REPORTS_PER_TENANT - 1);
  });
});

describe("relatórios: números e exportação", () => {
  it("valor sem dado sai como indisponível, nunca zero; exportação audita", async () => {
    const { service } = build();
    const csv = await service.exportCsv(ctx(A), ["revenue.cash_collected", "trial.starts.count"]);
    expect(csv).toContain("revenue.cash_collected,Caixa recebido,available,1000.50,currency,BRL");
    expect(csv).toMatch(/trial\.starts\.count,[^,]*,unavailable,,/);
    expect(auditLog.map((a) => a.action)).toContain("report.exported");
  });
  it("quem só enxerga algumas filiais não exporta dado da empresa", async () => {
    const { service } = build();
    companyLevel = false;
    await expect(service.exportCsv(ctx(A), ["revenue.cash_collected"])).rejects.toBeInstanceOf(PermissionDeniedError);
  });
  it("viewer não exporta", async () => {
    const { service } = build();
    await expect(service.exportCsv(ctx(A, "viewer"), ["revenue.cash_collected"])).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("relatórios: envio agendado", () => {
  it("manda uma vez por período, no idioma e com valores certos; repetir a rodada não reenvia", async () => {
    const { service, channels, provider } = build();
    await withChannel(A, channels);
    await createYesterday(service, A, input);
    const before = provider.accepted.length;
    expect(await service.runDue(nameOf, "c1")).toMatchObject({ sent: 1, failed: 0 });
    const sent = provider.accepted.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.subject).toBe("Relatório: Diário");
    expect(sent[0].message.body).toContain("Caixa recebido: R$");
    expect(sent[0].message.body).toContain("indisponível");
    expect(sent[0].message.body).not.toMatch(/Testes gratuitos iniciados: 0/);
    expect(await service.runDue(nameOf, "c2")).toMatchObject({ sent: 0 });
    expect(provider.accepted.length - before).toBe(1);
    const [r] = await service.list(ctx(A));
    expect(r.lastPeriodKey).toBe("2026-10-16");
    // dia seguinte, depois da hora: manda de novo, uma vez
    clock = new Date("2026-10-17T12:00:00Z");
    expect(await service.runDue(nameOf, "c3")).toMatchObject({ sent: 1 });
    expect(provider.accepted.length - before).toBe(2);
  });
  it("antes da hora marcada não envia; desligado não envia", async () => {
    const { service, channels, provider } = build();
    await withChannel(A, channels);
    const r = await createYesterday(service, A, { ...input, hour: 10 }, 22); // criado às 11h locais de ontem, depois das 10h dele // 10h locais = 13h UTC; agora são 09h locais
    const before = provider.accepted.length;
    expect((await service.runDue(nameOf, "c")).sent).toBe(0);
    clock = new Date("2026-10-16T13:30:00Z");
    await service.setEnabled(ctx(A), r.id, false);
    expect((await service.runDue(nameOf, "c")).sent).toBe(0);
    await service.setEnabled(ctx(A), r.id, true);
    expect((await service.runDue(nameOf, "c")).sent).toBe(1);
    expect(provider.accepted.length - before).toBe(1);
  });
  it("duas rodadas ao mesmo tempo enviam uma vez só", async () => {
    const { service, channels, provider } = build();
    await withChannel(A, channels, "conc@empresa.com");
    await createYesterday(service, A, input);
    const before = provider.accepted.filter((m) => m.message.to === "conc@empresa.com").length;
    await Promise.all([service.runDue(nameOf, "p1"), service.runDue(nameOf, "p2")]);
    expect(provider.accepted.filter((m) => m.message.to === "conc@empresa.com").length - before).toBe(1);
  });
  it("sem canal configurado, o período é dado como cumprido sem criar recibo (nada a enviar)", async () => {
    const { service } = build();
    await createYesterday(service, A, input);
    expect(await service.runDue(nameOf, "c")).toMatchObject({ sent: 1 });
    expect(await db.select().from(channelDeliveries).where(eq(channelDeliveries.tenantId, A))).toHaveLength(0);
  });
  it("relatório com problema não impede o das outras empresas", async () => {
    const { service, channels, provider } = build();
    await withChannel(B, channels, "b@empresa.com");
    await createYesterday(service, B, { ...input, name: "Da B" });
    await db.insert(reports).values({ tenantId: A, name: "Quebrado", metricIds: ["nao.existe"], frequency: "daily", hour: 8, createdBy: "u", createdAt: new Date("2026-10-14T12:00:00Z") });
    const before = provider.accepted.length;
    const result = await service.runDue(nameOf, "c");
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(provider.accepted.length - before).toBe(1);
  });
  it("'enviar agora' cria recibos novos a cada pedido e não mexe na marca do período", async () => {
    const { service, channels } = build();
    await withChannel(A, channels, "agora@empresa.com");
    const r = await service.create(ctx(A), input);
    expect((await service.sendNow(ctx(A), r.id, "n1", nameOf)).queued).toBe(1);
    expect((await service.sendNow(ctx(A), r.id, "n2", nameOf)).queued).toBe(1);
    expect((await service.list(ctx(A)))[0].lastPeriodKey).toBeNull();
    expect(await db.select().from(channelDeliveries).where(eq(channelDeliveries.tenantId, A))).toHaveLength(2);
    await expect(service.sendNow(ctx(B), r.id, "n3", nameOf)).rejects.toBeInstanceOf(ReportNotFoundError);
  });
});
