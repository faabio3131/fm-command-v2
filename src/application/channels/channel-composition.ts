import { ChannelService, type ChannelAudit, type CredentialWriter } from "@/application/channels/channel-service";
import type { AlertNotifier } from "@/application/alerts/alert-service";
import type { AlertMessageText } from "@/domain/channels/alert-message";
import type { ChannelSeverity, DeliveryReceipt } from "@/domain/channels/contracts";
import { sanitizeAuditMetadata } from "@/application/audit/sanitize-audit-metadata";
import { PostgresChannelRepository } from "@/infrastructure/channels/postgres-channel-repository";
import { defaultChannelRegistry } from "@/infrastructure/channels/channel-provider-registry";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { PostgresProfileRepository } from "@/infrastructure/i18n/postgres-profile-repository";
import { PostgresAlertRepository } from "@/infrastructure/alerts/postgres-alert-repository";
import { PostgresCredentialStore } from "@/infrastructure/integration/postgres-credential-store";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { createTranslator, type MessageKey } from "@/i18n/translate";

export const channelAudit: ChannelAudit = {
  async record(input) {
    await db.insert(auditEvents).values({
      tenantId: input.tenantId, actorId: input.actorId, actorType: input.actorId.startsWith("system:") ? "system" : "user",
      action: input.action, resourceType: input.resourceType, resourceId: input.resourceId, result: input.result,
      correlationId: input.correlationId, metadata: sanitizeAuditMetadata(input.metadata), occurredAt: new Date(),
    });
  },
};

export function buildChannelService(): ChannelService {
  const store = new PostgresCredentialStore();
  return new ChannelService({
    repository: new PostgresChannelRepository(),
    registry: defaultChannelRegistry(process.env),
    credentials: store as unknown as CredentialWriter,
    audit: channelAudit,
  });
}

/** Idioma das mensagens: o da empresa (perfil), senão o padrão. */
async function tenantLocale(tenantId: string): Promise<Locale> {
  try { return (await new PostgresProfileRepository().getOrgProfile(tenantId))?.defaultLocale ?? DEFAULT_LOCALE; } catch { return DEFAULT_LOCALE; }
}

export function alertText(locale: Locale, o: { metricId: string; severity: string; observedValue: string; operator: string; threshold: string }): AlertMessageText {
  const tr = createTranslator(locale);
  const key = `label.metricName.${o.metricId}` as MessageKey;
  const named = tr.t(key);
  const metric = named === key ? o.metricId : named;
  return {
    subject: tr.t("channel.alert.subject", { severity: o.severity.toUpperCase(), metric }),
    body: tr.t("channel.alert.body", { value: o.observedValue, operator: o.operator, threshold: o.threshold }),
  };
}

export async function testText(tenantId: string): Promise<AlertMessageText> {
  const tr = createTranslator(await tenantLocale(tenantId));
  return { subject: tr.t("channel.test.subject"), body: tr.t("channel.test.body") };
}

/** Ponte do alerta gerado para os canais. Nunca lança. */
export function buildAlertNotifier(service: ChannelService = buildChannelService()): AlertNotifier {
  return {
    async onOccurrence(o) {
      const text = alertText(await tenantLocale(o.tenantId), o);
      await service.notifyAlert({ tenantId: o.tenantId, occurrenceId: o.id, severity: o.severity as ChannelSeverity }, text);
    },
  };
}

/** Rodada de reenvio: tenta o que está vencido, refazendo o texto de cada recibo a partir da fonte. */
export async function dispatchDueChannelDeliveries(service: ChannelService = buildChannelService(), limit = 50) {
  const alerts = new PostgresAlertRepository();
  return service.dispatch({
    texts: new Map(), limit,
    rebuild: async (d: DeliveryReceipt) => {
      const locale = await tenantLocale(d.tenantId);
      if (d.sourceType === "test") return testText(d.tenantId);
      if (d.sourceType === "report") {
        const { rebuildReportText } = await import("@/application/reports/report-composition");
        return rebuildReportText(d.tenantId, d.sourceId);
      }
      if (d.sourceType !== "alert_occurrence") return null;
      const o = await alerts.findOccurrence(d.tenantId, d.sourceId);
      return o ? alertText(locale, o) : null;
    },
  });
}
