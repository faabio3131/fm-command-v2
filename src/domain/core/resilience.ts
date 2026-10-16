/**
 * Proteções contra falha em cascata (ADR-016, ADR-017): limite de chamadas simultâneas e disjuntor.
 * Puras, com relógio injetável, para serem testadas sem esperar tempo real.
 */

/** Divisória: no máximo `maxConcurrent` chamadas ao mesmo tempo; as demais são recusadas na hora. */
export class Bulkhead {
  private inFlight = 0;
  constructor(readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("resilience.bulkhead_limit_invalid");
  }
  /** Devolve a função que libera a vaga, ou null se estiver cheio. */
  tryAcquire(): (() => void) | null {
    if (this.inFlight >= this.maxConcurrent) return null;
    this.inFlight += 1;
    let released = false;
    return () => { if (!released) { released = true; this.inFlight -= 1; } };
  }
  get current(): number { return this.inFlight; }
}

export type CircuitState = "closed" | "open" | "half-open";

/**
 * Disjuntor: depois de `failureThreshold` falhas seguidas abre e recusa por `openMs`;
 * então deixa passar UMA chamada de teste (meio-aberto). Sucesso fecha; falha reabre.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    private readonly options: { failureThreshold: number; openMs: number },
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(options.failureThreshold) || options.failureThreshold < 1) throw new Error("resilience.threshold_invalid");
    if (!(options.openMs > 0)) throw new Error("resilience.open_ms_invalid");
  }

  get state(): CircuitState {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.options.openMs ? "half-open" : "open";
  }

  /** Pode chamar agora? No meio-aberto só a primeira chamada passa até haver resultado. */
  allow(): boolean {
    const s = this.state;
    if (s === "closed") return true;
    if (s === "open") return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  recordFailure(): void {
    this.probing = false;
    this.failures += 1;
    if (this.openedAt !== null || this.failures >= this.options.failureThreshold) this.openedAt = this.now();
  }
}
