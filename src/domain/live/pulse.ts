/**
 * Atualização ao vivo (etapa 10). O servidor devolve uma "marca de mudança" curta; a tela só se atualiza quando a marca muda.
 * A marca descreve apenas o que a pessoa pode ver (escopo de unidades) e não revela contagens nem datas.
 */
export interface PulseParts {
  /** Instante (ms) do valor de métrica mais novo dentro do escopo; nulo = nenhum. */
  readonly metricsLatest: number | null;
  /** Instante (ms) do evento de auditoria/alerta mais novo; nulo = nenhum ou fora do escopo. */
  readonly auditLatest: number | null;
}

export interface LiveClientState {
  readonly lastToken: string | null;
  readonly failures: number;
}

export const LIVE_POLL_MS = 5_000;
export const LIVE_MAX_BACKOFF_MS = 60_000;
/** Meta de projeto: do dado gravado até a tela mostrar, em até 10 s (5 s de consulta + tempo de desenhar). */
export const LIVE_TARGET_MS = 10_000;

export function pulseSource(parts: PulseParts): string {
  return `m:${parts.metricsLatest ?? "-"}|a:${parts.auditLatest ?? "-"}`;
}

/** A primeira marca só inicia o acompanhamento; só uma marca diferente pede nova leitura da tela. */
export function shouldRefresh(previous: string | null, next: string): boolean {
  return previous !== null && previous !== next;
}

/** Intervalo até a próxima consulta: normal em dia, e dobra a cada falha seguida até o teto. */
export function nextDelayMs(failures: number): number {
  if (failures <= 0) return LIVE_POLL_MS;
  return Math.min(LIVE_MAX_BACKOFF_MS, LIVE_POLL_MS * 2 ** failures);
}
