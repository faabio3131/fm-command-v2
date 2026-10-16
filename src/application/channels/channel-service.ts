import { toChannelMessage, contentHash, type AlertMessageText } from "@/domain/channels/alert-message";
import {
  ChannelProviderError, type ChannelConfig, type ChannelCredential, type ChannelKind, type ChannelSeverity,
  type DeliveryReceipt, CHANNEL_KINDS,
} from "@/domain/channels/contracts";
import { decideAfterFailure, isChannelKind, isSeverity, normalizeAddress, severityMeets } from "@/domain/channels/policy";
import type { CredentialStore } from "@/domain/integration/credentials";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import type { PostgresChannelRepository } from "@/infrastructure/channels/postgres-channel-repository";
import type { ChannelProviderRegistry, ProviderCatalogEntry } from "@/infrastructure/channels/channel-provider-registry";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ChannelInputError extends Error {
  constructor(readonly field: string) { super(`channel.input_invalid:${field}`); this.name = "ChannelInputError"; }
}
export class ChannelNotFoundError extends Error {
  constructor() { super("channel.not_found"); this.name = "ChannelNotFoundError"; }
}

export interface ChannelAudit {
  record(input: { tenantId: string; actorId: string; action: string; resourceType: string; resourceId: string | null; result: string; correlationId: string; metadata: Record<string, unknown> }): Promise<void>;
}
export interface CredentialWriter extends CredentialStore {
  save(tenantId: string, secretRef: string, credential: { kind: "api_key"; apiKey: string }): Promise<void>;
}

export interface AlertNotice {
  readonly tenantId: string;
  readonly occurrenceId: string;
  readonly severity: ChannelSeverity;
}

export interface ChannelServiceDeps {
  readonly repository: Pick<PostgresChannelRepository,
    "getConfig" | "listConfigs" | "saveConfig" | "listRecipients" | "addRecipient" | "setRecipientEnabled" | "removeRecipient" |
    "enqueue" | "claimDue" | "markSent" | "markFailed" | "expireStaleSending" | "recentDeliveries" | "findDelivery">;
  readonly registry: Pick<ChannelProviderRegistry, "catalog" | "get">;
  readonly credentials: CredentialWriter;
  readonly audit: ChannelAudit;
  readonly now?: () => Date;
}

/**
 * Configuração e envio pelos canais de cada empresa. A empresa escolhe o provedor entre os que o ambiente oferece, grava a chave no
 * cofre (nunca no banco de configuração nem no audit) e cadastra quem recebe. Todo envio vira um recibo; o mesmo envio não sai duas vezes.
 */
export class ChannelService {
  private readonly now: () => Date;
  constructor(private readonly deps: ChannelServiceDeps) { this.now = deps.now ?? (() => new Date()); }

  /** Painel da tela: catálogo de provedores, configuração, destinatários e últimos recibos. Nunca devolve credencial. */
  async overview(context: TenantContext) {
    requirePermission(context, "channel:read");
    const [configs, recipients, deliveries] = await Promise.all([
      this.deps.repository.listConfigs(context.tenantId), this.deps.repository.listRecipients(context.tenantId),
      this.deps.repository.recentDeliveries(context.tenantId, 30),
    ]);
    return { providers: this.deps.registry.catalog(), configs, recipients, deliveries };
  }

  private entry(kind: ChannelKind, providerId: string): ProviderCatalogEntry {
    const found = this.deps.registry.catalog(kind).find((p) => p.id === providerId);
    if (!found) throw new ChannelInputError("providerId");
    return found;
  }

  async saveConfig(context: TenantContext, input: { kind: unknown; providerId: unknown; sender: unknown; enabled: unknown; minSeverity: unknown; apiKey?: unknown }): Promise<ChannelConfig> {
    requirePermission(context, "channel:write");
    if (!isChannelKind(input.kind)) throw new ChannelInputError("kind");
    const kind = input.kind;
    if (typeof input.providerId !== "string") throw new ChannelInputError("providerId");
    const provider = this.entry(kind, input.providerId);
    const sender = typeof input.sender === "string" ? input.sender.trim() : "";
    if (sender.length === 0 || sender.length > 254) throw new ChannelInputError("sender");
    if (typeof input.enabled !== "boolean") throw new ChannelInputError("enabled");
    if (!isSeverity(input.minSeverity)) throw new ChannelInputError("minSeverity");
    const previous = await this.deps.repository.getConfig(context.tenantId, kind);
    let secretRef: string | null = null;
    if (provider.credential === "api_key") {
      secretRef = `channel/${kind}/${provider.id}`;
      const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      if (apiKey.length > 0) {
        if (apiKey.length < 8 || apiKey.length > 512) throw new ChannelInputError("apiKey");
        await this.deps.credentials.save(context.tenantId, secretRef, { kind: "api_key", apiKey });
      } else if (!previous || previous.secretRef !== secretRef) {
        throw new ChannelInputError("apiKey"); // primeira vez neste provedor: a chave é obrigatória
      }
    }
    const config: ChannelConfig = { tenantId: context.tenantId, kind, providerId: provider.id, secretRef, sender, enabled: input.enabled, minSeverity: input.minSeverity };
    await this.deps.repository.saveConfig(config, context.userId);
    await this.deps.audit.record({
      tenantId: context.tenantId, actorId: context.userId, action: "channel.config.updated", resourceType: "channel_config", resourceId: kind, result: "success",
      correlationId: context.correlationId, metadata: { kind, providerId: provider.id, enabled: config.enabled, minSeverity: config.minSeverity, credentialUpdated: Boolean(input.apiKey) },
    });
    return config;
  }

  async addRecipient(context: TenantContext, input: { kind: unknown; address: unknown; label?: unknown }): Promise<{ created: boolean }> {
    requirePermission(context, "channel:write");
    if (!isChannelKind(input.kind)) throw new ChannelInputError("kind");
    const address = normalizeAddress(input.kind, input.address);
    if (!address) throw new ChannelInputError("address");
    const label = typeof input.label === "string" ? input.label.trim().slice(0, 80) : "";
    const created = await this.deps.repository.addRecipient({ tenantId: context.tenantId, kind: input.kind, address, label, createdBy: context.userId });
    if (created) {
      // O audit não guarda o endereço (dado pessoal): só o canal.
      await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "channel.recipient.added", resourceType: "channel_recipient", resourceId: null, result: "success", correlationId: context.correlationId, metadata: { kind: input.kind } });
    }
    return { created };
  }

  async setRecipientEnabled(context: TenantContext, id: string, enabled: boolean): Promise<void> {
    requirePermission(context, "channel:write");
    if (!UUID.test(id)) throw new ChannelNotFoundError();
    if (!(await this.deps.repository.setRecipientEnabled(context.tenantId, id, enabled))) throw new ChannelNotFoundError();
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "channel.recipient.toggled", resourceType: "channel_recipient", resourceId: id, result: "success", correlationId: context.correlationId, metadata: { enabled } });
  }

  async removeRecipient(context: TenantContext, id: string): Promise<void> {
    requirePermission(context, "channel:write");
    if (!UUID.test(id)) throw new ChannelNotFoundError();
    if (!(await this.deps.repository.removeRecipient(context.tenantId, id))) throw new ChannelNotFoundError();
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "channel.recipient.removed", resourceType: "channel_recipient", resourceId: id, result: "success", correlationId: context.correlationId, metadata: {} });
  }

  /** Mensagem de teste para um destinatário (cada clique é um envio novo, com recibo). */
  async sendTest(context: TenantContext, recipientId: string, text: AlertMessageText, nonce: string): Promise<DeliveryReceipt> {
    requirePermission(context, "channel:write");
    if (!UUID.test(recipientId)) throw new ChannelNotFoundError();
    const recipient = (await this.deps.repository.listRecipients(context.tenantId)).find((r) => r.id === recipientId);
    if (!recipient) throw new ChannelNotFoundError();
    const config = await this.deps.repository.getConfig(context.tenantId, recipient.kind);
    if (!config) throw new ChannelInputError("config");
    const { delivery } = await this.deps.repository.enqueue({
      tenantId: context.tenantId, kind: recipient.kind, providerId: config.providerId, recipient: recipient.address,
      dedupeKey: `test:${nonce}`, subject: text.subject, contentHash: contentHash(text), sourceType: "test", sourceId: recipient.id, availableAt: this.now(),
    });
    await this.dispatch({ onlyIds: [delivery.id], texts: new Map([[delivery.id, text]]) });
    return (await this.deps.repository.findDelivery(context.tenantId, delivery.id)) ?? delivery;
  }

  /**
   * Alerta gerado: cria um recibo por destinatário ativo dos canais ligados cuja gravidade mínima o alerta alcança, e tenta enviar.
   * O mesmo alerta nunca gera dois recibos para o mesmo destinatário (a identidade do envio é a ocorrência). Nunca lança: falha de
   * canal não pode derrubar a avaliação do alerta.
   */
  async notifyAlert(notice: AlertNotice, text: AlertMessageText): Promise<{ queued: number; skipped: number }> {
    let queued = 0;
    let skipped = 0;
    try {
      const ids: string[] = [];
      const texts = new Map<string, AlertMessageText>();
      for (const kind of CHANNEL_KINDS) {
        const config = await this.deps.repository.getConfig(notice.tenantId, kind);
        if (!config || !config.enabled || !severityMeets(notice.severity, config.minSeverity)) { skipped += 1; continue; }
        for (const recipient of await this.deps.repository.listRecipients(notice.tenantId, kind)) {
          if (!recipient.enabled) continue;
          const { created, delivery } = await this.deps.repository.enqueue({
            tenantId: notice.tenantId, kind, providerId: config.providerId, recipient: recipient.address,
            dedupeKey: `alert:${notice.occurrenceId}`, subject: text.subject, contentHash: contentHash(text), sourceType: "alert_occurrence", sourceId: notice.occurrenceId, availableAt: this.now(),
          });
          if (created) { queued += 1; ids.push(delivery.id); texts.set(delivery.id, text); }
        }
      }
      if (ids.length > 0) await this.dispatch({ onlyIds: ids, texts });
    } catch {
      // Silencioso de propósito: o recibo pendente (se já criado) será tentado na próxima rodada.
    }
    return { queued, skipped };
  }

  /**
   * Envia o que está vencido. `texts` traz o texto de quem acabou de criar o recibo; na rodada de retentativa o texto é refeito pelo
   * chamador (`rebuild`), porque o recibo guarda só o resumo do conteúdo.
   */
  async dispatch(input: { onlyIds?: readonly string[]; texts: ReadonlyMap<string, AlertMessageText>; rebuild?: (delivery: DeliveryReceipt) => Promise<AlertMessageText | null>; limit?: number }): Promise<{ sent: number; failed: number; uncertain: number; retry: number }> {
    const now = this.now();
    await this.deps.repository.expireStaleSending(now);
    const claimed = await this.deps.repository.claimDue(input.limit ?? 50, now, input.onlyIds);
    const counts = { sent: 0, failed: 0, uncertain: 0, retry: 0 };
    for (const delivery of claimed) {
      const text = input.texts.get(delivery.id) ?? (await input.rebuild?.(delivery)) ?? null;
      const outcome = await this.sendOne(delivery, text);
      counts[outcome] += 1;
    }
    return counts;
  }

  private async sendOne(delivery: DeliveryReceipt, text: AlertMessageText | null): Promise<"sent" | "failed" | "uncertain" | "retry"> {
    const now = this.now();
    try {
      if (!text) throw new ChannelProviderError("channel.message_unavailable", "rejected");
      const config = await this.deps.repository.getConfig(delivery.tenantId, delivery.kind);
      const provider = config ? this.deps.registry.get(delivery.kind, config.providerId) : null;
      if (!config || !config.enabled || !provider) throw new ChannelProviderError("channel.not_configured", "rejected");
      let credential: ChannelCredential = {};
      if (provider.credential === "api_key") {
        try {
          const stored = config.secretRef ? await this.deps.credentials.resolve(delivery.tenantId, config.secretRef) : null;
          credential = stored && stored.kind === "api_key" ? { apiKey: stored.apiKey } : {};
        } catch { throw new ChannelProviderError("channel.credential_missing", "rejected"); }
      }
      const result = await provider.send(toChannelMessage(delivery.kind, delivery.recipient, text, delivery.dedupeKey), { from: config.sender }, credential);
      await this.deps.repository.markSent(delivery.id, result.providerMessageId, now);
      return "sent";
    } catch (error) {
      const failure = error instanceof ChannelProviderError ? error : new ChannelProviderError("channel.unexpected_error", "transient");
      const decision = decideAfterFailure(failure, delivery.attempts, now);
      await this.deps.repository.markFailed(delivery.id, decision.status as "failed_transient" | "failed" | "uncertain", failure.code, decision.nextAttemptAt);
      return decision.status === "failed_transient" ? "retry" : decision.status === "uncertain" ? "uncertain" : "failed";
    }
  }
}
