import { createHash } from "node:crypto";
import { ChannelProviderError, type ChannelCredential, type ChannelKind, type ChannelMessage, type ChannelProvider, type ChannelSender } from "@/domain/channels/contracts";

/**
 * Provedor simulado: prova a camada de canais sem conta real e sem enviar nada a ninguém.
 * Comportamento por destinatário, para os testes provocarem cada caso (a parte antes do @ ou do número):
 *  - contém "+transient2": falha 2 vezes como transitório para a mesma mensagem e depois aceita;
 *  - contém "+reject": recusa;
 *  - contém "+uncertain": resposta perdida (pode ter sido entregue).
 * Aceitar a mesma identidade de envio duas vezes devolve o mesmo id e não registra de novo (como um provedor idempotente de verdade).
 */
export class SimulatedChannelProvider implements ChannelProvider {
  /** Mensagens aceitas, só em memória deste processo (para testes). */
  readonly accepted: { message: ChannelMessage; from: string }[] = [];
  private readonly ids = new Map<string, string>();
  private readonly failures = new Map<string, number>();

  constructor(readonly id: string, readonly kind: ChannelKind, readonly credential: "none" | "api_key" = "none") {}

  async send(message: ChannelMessage, sender: ChannelSender, credential: ChannelCredential): Promise<{ providerMessageId: string }> {
    if (this.credential === "api_key" && (credential.apiKey ?? "").length < 8) throw new ChannelProviderError("channel.credential_rejected", "rejected");
    const key = `${message.to}|${message.dedupeKey}`;
    if (message.to.includes("+reject")) throw new ChannelProviderError("channel.recipient_rejected", "rejected");
    if (message.to.includes("+uncertain")) throw new ChannelProviderError("channel.response_lost", "uncertain");
    if (message.to.includes("+transient2")) {
      const seen = this.failures.get(key) ?? 0;
      if (seen < 2) {
        this.failures.set(key, seen + 1);
        throw new ChannelProviderError("channel.provider_unavailable", "transient");
      }
    }
    const existing = this.ids.get(key);
    if (existing) return { providerMessageId: existing };
    const providerMessageId = `sim-${createHash("sha256").update(`${this.id}|${key}`).digest("hex").slice(0, 16)}`;
    this.ids.set(key, providerMessageId);
    this.accepted.push({ message, from: sender.from });
    return { providerMessageId };
  }
}
