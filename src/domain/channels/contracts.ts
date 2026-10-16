/**
 * Canais de envio (etapa 12): e-mail e WhatsApp. O restante do sistema só conhece este contrato; o provedor
 * (simulador, SMTP, API de e-mail, WhatsApp Cloud API...) é escolhido por empresa, por configuração, sem mudar código.
 */
export const CHANNEL_KINDS = ["email", "whatsapp"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const SEVERITY_ORDER = ["info", "warning", "critical"] as const;
export type ChannelSeverity = (typeof SEVERITY_ORDER)[number];

export class ChannelProviderError extends Error {
  /**
   * - transient: o provedor não chegou a aceitar (conexão recusada, 429, 5xx): pode tentar de novo com espera.
   * - rejected: o provedor recusou (endereço inválido, credencial recusada): não adianta repetir.
   * - uncertain: a resposta se perdeu depois do envio (tempo esgotado): pode ter sido entregue; NUNCA reenviar sozinho.
   */
  constructor(readonly code: string, readonly outcome: "transient" | "rejected" | "uncertain") {
    super(code);
    this.name = "ChannelProviderError";
  }
}

export interface ChannelMessage {
  readonly kind: ChannelKind;
  /** E-mail ou telefone em formato internacional (+5511999990000). */
  readonly to: string;
  readonly subject?: string;
  readonly body: string;
  /** Identidade estável do envio: o provedor que a aceitar usa para não duplicar. */
  readonly dedupeKey: string;
}

export interface ChannelSender {
  /** Remetente configurado pela empresa (e-mail de origem ou número/identificador do WhatsApp). */
  readonly from: string;
}

export interface ChannelCredential {
  readonly apiKey?: string;
}

export interface ChannelProvider {
  readonly id: string;
  readonly kind: ChannelKind;
  /** "none" = o provedor não precisa de credencial; "api_key" = precisa de uma chave guardada no cofre da empresa. */
  readonly credential: "none" | "api_key";
  send(message: ChannelMessage, sender: ChannelSender, credential: ChannelCredential): Promise<{ providerMessageId: string }>;
}

export interface ChannelConfig {
  readonly tenantId: string;
  readonly kind: ChannelKind;
  readonly providerId: string;
  /** Referência no cofre de credenciais; nunca o valor. Nulo quando o provedor não usa credencial. */
  readonly secretRef: string | null;
  readonly sender: string;
  readonly enabled: boolean;
  /** Só alertas desta gravidade para cima são enviados por este canal. */
  readonly minSeverity: ChannelSeverity;
}

export interface ChannelRecipient {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: ChannelKind;
  readonly address: string;
  readonly label: string;
  readonly enabled: boolean;
}

export type DeliveryStatus = "pending" | "sending" | "sent" | "failed_transient" | "failed" | "uncertain";

export interface DeliveryReceipt {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: ChannelKind;
  readonly providerId: string;
  readonly recipient: string;
  readonly dedupeKey: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date | null;
  readonly providerMessageId: string | null;
  readonly errorCode: string | null;
  readonly subject: string | null;
  readonly contentHash: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
}
