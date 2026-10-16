/**
 * Limitador por chave (empresa + conector + método): janela deslizante de
 * chamadas por minuto e teto de chamadas simultâneas. Os valores vêm da
 * configuração do conector, nunca do código do chamador.
 */
export interface RateLimits {
  readonly requestsPerMinute: number;
  readonly maxConcurrent: number;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface Bucket {
  stamps: number[];
  active: number;
  waiters: Array<() => void>;
}

const MAX_WAITERS = 100;

export class RateLimitWaitExceededError extends Error {
  constructor() {
    super("integration.rate_limit_wait_exceeded");
    this.name = "RateLimitWaitExceededError";
  }
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly clock: Clock = systemClock) {}

  /**
   * `maxWaitMs`: tempo máximo de espera por vaga. Estourou, lança RateLimitWaitExceededError
   * ANTES de iniciar a tarefa (nunca deixa uma chamada órfã rodando depois do prazo).
   */
  async run<T>(
    key: string,
    limits: RateLimits,
    task: () => Promise<T>,
    options: { maxWaitMs?: number } = {},
  ): Promise<T> {
    if (
      !Number.isInteger(limits.requestsPerMinute) || limits.requestsPerMinute < 1 ||
      !Number.isInteger(limits.maxConcurrent) || limits.maxConcurrent < 1
    ) {
      throw new Error("integration.rate_limits_invalid");
    }
    const bucket = this.bucket(key);
    await this.acquire(bucket, limits, options.maxWaitMs);
    try {
      return await task();
    } finally {
      bucket.active -= 1;
      bucket.waiters.shift()?.();
    }
  }

  private bucket(key: string): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { stamps: [], active: 0, waiters: [] };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private async acquire(bucket: Bucket, limits: RateLimits, maxWaitMs?: number): Promise<void> {
    const started = this.clock.now();
    const deadline = maxWaitMs === undefined ? Infinity : started + maxWaitMs;
    for (;;) {
      if (bucket.active >= limits.maxConcurrent) {
        if (bucket.waiters.length >= MAX_WAITERS) throw new RateLimitWaitExceededError();
        await this.waitForRelease(bucket, maxWaitMs === undefined ? undefined : Math.max(0, deadline - this.clock.now()));
        continue;
      }
      const now = this.clock.now();
      bucket.stamps = bucket.stamps.filter((t) => now - t < 60_000);
      if (bucket.stamps.length >= limits.requestsPerMinute) {
        const wait = Math.max(1, 60_000 - (now - bucket.stamps[0]));
        if (now + wait > deadline) throw new RateLimitWaitExceededError();
        await this.clock.sleep(wait);
        continue;
      }
      bucket.stamps.push(now);
      bucket.active += 1;
      return;
    }
  }

  private waitForRelease(bucket: Bucket, timeoutMs?: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      bucket.waiters.push(waiter);
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const index = bucket.waiters.indexOf(waiter);
          if (index >= 0) bucket.waiters.splice(index, 1);
          reject(new RateLimitWaitExceededError());
        }, timeoutMs);
      }
    });
  }
}
