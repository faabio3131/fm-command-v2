import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { ChannelProviderError, type ChannelCredential, type ChannelMessage, type ChannelProvider, type ChannelSender } from "@/domain/channels/contracts";

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  /** TLS direto (porta 465). Com false, usa STARTTLS quando o servidor oferece (e exige, se requireTls). */
  readonly secure: boolean;
  readonly requireTls: boolean;
  readonly user: string | null;
  readonly timeoutMs: number;
}

/** Erros do nodemailer separados pelo ponto em que ocorreram: antes de o servidor aceitar a mensagem (seguro repetir) ou depois (incerto). */
export function classifySmtpError(error: unknown): ChannelProviderError {
  const e = error as { code?: string; responseCode?: number; message?: string };
  const message = String(e.message ?? "");
  if (e.code === "EAUTH" || e.responseCode === 535 || e.responseCode === 534) return new ChannelProviderError("channel.credential_rejected", "rejected");
  // 4xx: o servidor mandou tentar depois (o nodemailer embrulha 4xx do RCPT como EENVELOPE, por isso vem antes).
  if (e.responseCode && e.responseCode >= 400 && e.responseCode < 500) return new ChannelProviderError("channel.provider_unavailable", "transient");
  if (e.code === "EENVELOPE" || (e.responseCode && e.responseCode >= 500 && e.responseCode < 600)) return new ChannelProviderError("channel.recipient_rejected", "rejected");
  // Só é "nada foi aceito" quando a falha é claramente de conexão. O nodemailer chama de CONN também o silêncio depois
  // dos dados; qualquer timeout que não seja de conexão/saudação, ou queda de socket, fica incerto (nunca reenviar sozinho).
  const neverConnected = e.code === "EDNS" || e.code === "ETLS" || e.code === "ECONNECTION"
    || /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|^Connection timeout|^Greeting never received/.test(message);
  if (neverConnected) return new ChannelProviderError("channel.provider_unavailable", "transient");
  return new ChannelProviderError("channel.response_lost", "uncertain");
}

/** E-mail por SMTP. A senha vem do cofre da empresa (apiKey); o usuário vem da configuração do ambiente. */
export class SmtpChannelProvider implements ChannelProvider {
  readonly id = "smtp";
  readonly kind = "email" as const;
  readonly credential: "none" | "api_key";

  constructor(private readonly config: SmtpConfig) {
    this.credential = config.user ? "api_key" : "none";
  }

  async send(message: ChannelMessage, sender: ChannelSender, credential: ChannelCredential): Promise<{ providerMessageId: string }> {
    if (this.config.user && !credential.apiKey) throw new ChannelProviderError("channel.credential_rejected", "rejected");
    const transport = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      requireTLS: this.config.requireTls,
      auth: this.config.user ? { user: this.config.user, pass: credential.apiKey } : undefined,
      connectionTimeout: this.config.timeoutMs,
      greetingTimeout: this.config.timeoutMs,
      socketTimeout: this.config.timeoutMs,
    });
    // Message-ID estável por envio: quem receber duas cópias reconhece a mesma mensagem.
    const messageId = `<${createHash("sha256").update(`${message.to}|${message.dedupeKey}`).digest("hex").slice(0, 24)}@fm-command>`;
    try {
      const info = await transport.sendMail({ from: sender.from, to: message.to, subject: message.subject ?? "", text: message.body, messageId });
      if (!info.accepted?.length) throw new ChannelProviderError("channel.recipient_rejected", "rejected");
      return { providerMessageId: info.messageId ?? messageId };
    } catch (error) {
      if (error instanceof ChannelProviderError) throw error;
      throw classifySmtpError(error);
    } finally {
      transport.close();
    }
  }
}
