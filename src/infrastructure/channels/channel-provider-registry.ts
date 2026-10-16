import type { ChannelKind, ChannelProvider } from "@/domain/channels/contracts";
import { SimulatedChannelProvider } from "./simulated-channel-provider";
import { SmtpChannelProvider } from "./smtp-channel-provider";
import { WhatsappCloudProvider } from "./whatsapp-cloud-provider";

export interface ProviderCatalogEntry {
  readonly id: string;
  readonly kind: ChannelKind;
  readonly credential: "none" | "api_key";
  /** Provedor de mentira: não envia nada a ninguém. A tela avisa. */
  readonly simulated: boolean;
}

/** Provedores que o ambiente permite. Nenhum existe sem a configuração própria dele; o catálogo é o que a tela oferece. */
export class ChannelProviderRegistry {
  constructor(private readonly providers: readonly ChannelProvider[], private readonly simulated: ReadonlySet<string>) {}

  catalog(kind?: ChannelKind): readonly ProviderCatalogEntry[] {
    return this.providers.filter((p) => !kind || p.kind === kind)
      .map((p) => ({ id: p.id, kind: p.kind, credential: p.credential, simulated: this.simulated.has(p.id) }));
  }

  get(kind: ChannelKind, id: string): ChannelProvider | null {
    return this.providers.find((p) => p.kind === kind && p.id === id) ?? null;
  }
}

/**
 * Simulador: só com FMCC_CHANNEL_SIMULATED=1, e em produção só com a segunda chave FMCC_CHANNEL_ALLOW_SIMULATED=1
 * (ambiente de homologação). Em produção de verdade ele nunca liga sozinho.
 */
export function defaultChannelRegistry(env: Record<string, string | undefined> = process.env): ChannelProviderRegistry {
  const providers: ChannelProvider[] = [];
  const simulated = new Set<string>();
  const production = env.NODE_ENV === "production";
  if (env.FMCC_CHANNEL_SIMULATED === "1" && (!production || env.FMCC_CHANNEL_ALLOW_SIMULATED === "1")) {
    for (const p of [
      new SimulatedChannelProvider("simulated_email", "email"),
      new SimulatedChannelProvider("simulated_email_keyed", "email", "api_key"),
      new SimulatedChannelProvider("simulated_whatsapp", "whatsapp"),
    ]) { providers.push(p); simulated.add(p.id); }
  }
  // Provedores reais: cada um só existe quando a própria configuração do ambiente o liga.
  if (env.FMCC_SMTP_HOST) {
    providers.push(new SmtpChannelProvider({
      host: env.FMCC_SMTP_HOST,
      port: Number(env.FMCC_SMTP_PORT ?? 587),
      secure: env.FMCC_SMTP_SECURE === "1",
      requireTls: env.FMCC_SMTP_REQUIRE_TLS !== "0",
      user: env.FMCC_SMTP_USER || null,
      timeoutMs: Number(env.FMCC_SMTP_TIMEOUT_MS ?? 15000),
    }));
  }
  if (env.FMCC_WHATSAPP_CLOUD_API_BASE) {
    providers.push(new WhatsappCloudProvider({ apiBase: env.FMCC_WHATSAPP_CLOUD_API_BASE, timeoutMs: Number(env.FMCC_WHATSAPP_TIMEOUT_MS ?? 15000) }));
  }
  return new ChannelProviderRegistry(providers, simulated);
}
