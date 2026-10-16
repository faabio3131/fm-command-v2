import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type {
  ChannelConfig, ChannelKind, ChannelRecipient, ChannelSeverity, DeliveryReceipt, DeliveryStatus,
} from "@/domain/channels/contracts";
import { SENDING_LEASE_MS } from "@/domain/channels/policy";
import { db } from "@/infrastructure/db/client";
import { channelConfigs, channelDeliveries, channelRecipients } from "@/infrastructure/db/channel-schema";

type Row = typeof channelDeliveries.$inferSelect;

function receipt(row: Row): DeliveryReceipt {
  return {
    id: row.id, tenantId: row.tenantId, kind: row.kind as ChannelKind, providerId: row.providerId, recipient: row.recipient,
    dedupeKey: row.dedupeKey, status: row.status as DeliveryStatus, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt,
    providerMessageId: row.providerMessageId, errorCode: row.errorCode, subject: row.subject, contentHash: row.contentHash,
    sourceType: row.sourceType, sourceId: row.sourceId, createdAt: row.createdAt, sentAt: row.sentAt,
  };
}

export interface NewDelivery {
  readonly tenantId: string;
  readonly kind: ChannelKind;
  readonly providerId: string;
  readonly recipient: string;
  readonly dedupeKey: string;
  readonly subject: string | null;
  readonly contentHash: string;
  readonly sourceType: string;
  readonly sourceId: string;
  /** Quando o envio fica disponível; padrão: agora. */
  readonly availableAt?: Date;
}

/** Todas as leituras e escritas filtram pela empresa; a única consulta entre empresas é a fila de envios vencidos. */
export class PostgresChannelRepository {
  async getConfig(tenantId: string, kind: ChannelKind): Promise<ChannelConfig | null> {
    const [row] = await db.select().from(channelConfigs).where(and(eq(channelConfigs.tenantId, tenantId), eq(channelConfigs.kind, kind))).limit(1);
    return row ? { tenantId, kind, providerId: row.providerId, secretRef: row.secretRef, sender: row.sender, enabled: row.enabled, minSeverity: row.minSeverity as ChannelSeverity } : null;
  }

  async listConfigs(tenantId: string): Promise<readonly ChannelConfig[]> {
    const rows = await db.select().from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId));
    return rows.map((row) => ({ tenantId, kind: row.kind as ChannelKind, providerId: row.providerId, secretRef: row.secretRef, sender: row.sender, enabled: row.enabled, minSeverity: row.minSeverity as ChannelSeverity }));
  }

  async saveConfig(config: ChannelConfig, updatedBy: string): Promise<void> {
    const values = { providerId: config.providerId, secretRef: config.secretRef, sender: config.sender, enabled: config.enabled, minSeverity: config.minSeverity, updatedBy, updatedAt: new Date() };
    await db.insert(channelConfigs).values({ tenantId: config.tenantId, kind: config.kind, ...values })
      .onConflictDoUpdate({ target: [channelConfigs.tenantId, channelConfigs.kind], set: values });
  }

  async listRecipients(tenantId: string, kind?: ChannelKind): Promise<readonly ChannelRecipient[]> {
    const rows = await db.select().from(channelRecipients)
      .where(kind ? and(eq(channelRecipients.tenantId, tenantId), eq(channelRecipients.kind, kind)) : eq(channelRecipients.tenantId, tenantId))
      .orderBy(asc(channelRecipients.kind), asc(channelRecipients.address));
    return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, kind: r.kind as ChannelKind, address: r.address, label: r.label, enabled: r.enabled }));
  }

  /** Falso quando o endereço já existe neste canal (não duplica). */
  async addRecipient(input: { tenantId: string; kind: ChannelKind; address: string; label: string; createdBy: string }): Promise<boolean> {
    const rows = await db.insert(channelRecipients).values(input).onConflictDoNothing().returning({ id: channelRecipients.id });
    return rows.length > 0;
  }

  async setRecipientEnabled(tenantId: string, id: string, enabled: boolean): Promise<boolean> {
    const rows = await db.update(channelRecipients).set({ enabled })
      .where(and(eq(channelRecipients.tenantId, tenantId), eq(channelRecipients.id, id))).returning({ id: channelRecipients.id });
    return rows.length > 0;
  }

  async removeRecipient(tenantId: string, id: string): Promise<boolean> {
    const rows = await db.delete(channelRecipients)
      .where(and(eq(channelRecipients.tenantId, tenantId), eq(channelRecipients.id, id))).returning({ id: channelRecipients.id });
    return rows.length > 0;
  }

  /** Cria o recibo; se a mesma entrega já existe (mesma empresa, canal, destinatário e identidade), não cria outro. */
  async enqueue(input: NewDelivery): Promise<{ created: boolean; delivery: DeliveryReceipt }> {
    const { availableAt, ...fields } = input;
    const inserted = await db.insert(channelDeliveries).values({ ...fields, status: "pending", nextAttemptAt: availableAt ?? new Date() })
      .onConflictDoNothing().returning();
    if (inserted[0]) return { created: true, delivery: receipt(inserted[0]) };
    const [existing] = await db.select().from(channelDeliveries).where(and(
      eq(channelDeliveries.tenantId, input.tenantId), eq(channelDeliveries.kind, input.kind),
      eq(channelDeliveries.recipient, input.recipient), eq(channelDeliveries.dedupeKey, input.dedupeKey),
    )).limit(1);
    return { created: false, delivery: receipt(existing as Row) };
  }

  /**
   * Pega envios vencidos e os marca "enviando" na mesma instrução (FOR UPDATE SKIP LOCKED): dois processos nunca pegam o mesmo.
   * `onlyTenantId` limita à empresa quando o envio nasce de uma ação dela.
   */
  async claimDue(limit: number, now: Date, onlyIds?: readonly string[]): Promise<readonly DeliveryReceipt[]> {
    const idFilter = onlyIds && onlyIds.length > 0 ? sql`and id in (${sql.join(onlyIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
    const result = await db.execute(sql`
      update fmcc_channel_delivery set status = 'sending', attempt_started_at = ${now}, attempts = attempts + 1
      where id in (
        select id from fmcc_channel_delivery
        where status in ('pending','failed_transient') and (next_attempt_at is null or next_attempt_at <= ${now}) ${idFilter}
        order by next_attempt_at nulls first limit ${limit} for update skip locked
      )
      returning *`);
    return (result.rows as Record<string, unknown>[]).map((r) => receipt({
      id: r.id as string, tenantId: r.tenant_id as string, kind: r.kind as string, providerId: r.provider_id as string,
      recipient: r.recipient as string, dedupeKey: r.dedupe_key as string, status: r.status as string, attempts: r.attempts as number,
      nextAttemptAt: r.next_attempt_at ? new Date(r.next_attempt_at as string) : null,
      attemptStartedAt: r.attempt_started_at ? new Date(r.attempt_started_at as string) : null,
      providerMessageId: (r.provider_message_id as string) ?? null, errorCode: (r.error_code as string) ?? null,
      subject: (r.subject as string) ?? null, contentHash: r.content_hash as string, sourceType: r.source_type as string,
      sourceId: r.source_id as string, createdAt: new Date(r.created_at as string),
      sentAt: r.sent_at ? new Date(r.sent_at as string) : null,
    } as Row));
  }

  async markSent(id: string, providerMessageId: string, now: Date): Promise<void> {
    await db.update(channelDeliveries).set({ status: "sent", providerMessageId, sentAt: now, nextAttemptAt: null, errorCode: null })
      .where(and(eq(channelDeliveries.id, id), eq(channelDeliveries.status, "sending")));
  }

  async markFailed(id: string, status: Exclude<DeliveryStatus, "pending" | "sending" | "sent">, errorCode: string, nextAttemptAt: Date | null): Promise<void> {
    await db.update(channelDeliveries).set({ status, errorCode, nextAttemptAt })
      .where(and(eq(channelDeliveries.id, id), eq(channelDeliveries.status, "sending")));
  }

  /** Envio preso em "enviando" há mais que o prazo: o processo pode ter caído depois de enviar, então vira incerto (não reenvia). */
  async expireStaleSending(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - SENDING_LEASE_MS);
    const rows = await db.update(channelDeliveries).set({ status: "uncertain", errorCode: "channel.sending_lease_expired", nextAttemptAt: null })
      .where(and(eq(channelDeliveries.status, "sending"), lte(channelDeliveries.attemptStartedAt, cutoff))).returning({ id: channelDeliveries.id });
    return rows.length;
  }

  async recentDeliveries(tenantId: string, limit: number): Promise<readonly DeliveryReceipt[]> {
    const rows = await db.select().from(channelDeliveries).where(eq(channelDeliveries.tenantId, tenantId))
      .orderBy(desc(channelDeliveries.createdAt)).limit(limit);
    return rows.map(receipt);
  }

  async findDelivery(tenantId: string, id: string): Promise<DeliveryReceipt | null> {
    const [row] = await db.select().from(channelDeliveries).where(and(eq(channelDeliveries.tenantId, tenantId), eq(channelDeliveries.id, id))).limit(1);
    return row ? receipt(row) : null;
  }
}

