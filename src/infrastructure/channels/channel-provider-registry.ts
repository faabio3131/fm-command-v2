import type { ChannelKind, ChannelProvider } from "@/domain/channels/contracts";
import { SimulatedChannelProvider } from "./simulated-channel-provider";

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
  return new ChannelProviderRegistry(providers, simulated);
}
