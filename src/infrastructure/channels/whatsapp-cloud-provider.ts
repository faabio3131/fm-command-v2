import { ChannelProviderError, type ChannelCredential, type ChannelMessage, type ChannelProvider, type ChannelSender } from "@/domain/channels/contracts";

export interface WhatsappCloudConfig {
  /** Ex.: https://graph.facebook.com/v25.0 (nos testes, um servidor local). */
  readonly apiBase: string;
  readonly timeoutMs: number;
}

/**
 * WhatsApp Cloud API. O token de acesso vem do cofre da empresa; o remetente (sender.from) é o "phone number id".
 * Texto livre só chega dentro da janela de 24h de conversa iniciada pelo cliente; fora dela a API recusa (131047) e
 * o envio fica como recusado, até existirem modelos aprovados (fase final, depende de conta Meta verificada).
 */
export class WhatsappCloudProvider implements ChannelProvider {
  readonly id = "whatsapp_cloud";
  readonly kind = "whatsapp" as const;
  readonly credential = "api_key" as const;

  constructor(private readonly config: WhatsappCloudConfig) {}

  async send(message: ChannelMessage, sender: ChannelSender, credential: ChannelCredential): Promise<{ providerMessageId: string }> {
    if (!credential.apiKey) throw new ChannelProviderError("channel.credential_rejected", "rejected");
    const url = `${this.config.apiBase.replace(/\/$/, "")}/${encodeURIComponent(sender.from)}/messages`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${credential.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: message.to.replace(/^\+/, ""), type: "text", text: { body: message.body, preview_url: false } }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = (error as { name?: string }).name === "AbortError";
      // Tempo esgotado: o pedido pode ter sido processado. Falha de conexão (ECONNREFUSED/DNS): nada foi aceito.
      if (aborted) throw new ChannelProviderError("channel.response_lost", "uncertain");
      throw new ChannelProviderError("channel.provider_unavailable", "transient");
    }
    clearTimeout(timer);
    if (response.status === 429 || response.status >= 500) throw new ChannelProviderError("channel.provider_unavailable", "transient");
    if (response.status === 401 || response.status === 403) throw new ChannelProviderError("channel.credential_rejected", "rejected");
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: number } } | null;
      // 130429/131056: limite de taxa do número ou par: tentar depois.
      if (body?.error?.code === 130429 || body?.error?.code === 131056) throw new ChannelProviderError("channel.provider_unavailable", "transient");
      if (body?.error?.code === 190) throw new ChannelProviderError("channel.credential_rejected", "rejected");
      throw new ChannelProviderError("channel.recipient_rejected", "rejected");
    }
    const body = (await response.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
    const id = body?.messages?.[0]?.id;
    // 2xx sem id: o provedor pode ter aceitado; não dá para afirmar nem negar.
    if (!id) throw new ChannelProviderError("channel.response_lost", "uncertain");
    return { providerMessageId: id };
  }
}
