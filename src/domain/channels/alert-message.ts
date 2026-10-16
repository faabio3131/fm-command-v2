import { createHash } from "node:crypto";
import type { ChannelKind, ChannelMessage } from "./contracts";

export interface AlertMessageText {
  readonly subject: string;
  readonly body: string;
}

export function contentHash(text: AlertMessageText): string {
  return createHash("sha256").update(`${text.subject}\n${text.body}`).digest("hex");
}

/** Monta a mensagem do canal a partir do texto já traduzido. WhatsApp não tem assunto: ele vai na primeira linha. */
export function toChannelMessage(kind: ChannelKind, to: string, text: AlertMessageText, dedupeKey: string): ChannelMessage {
  if (kind === "email") return { kind, to, subject: text.subject, body: text.body, dedupeKey };
  return { kind, to, body: `${text.subject}\n\n${text.body}`, dedupeKey };
}
