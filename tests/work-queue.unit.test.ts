import { describe, expect, it } from "vitest";
import { retryDelayMs } from "@/domain/core/work-queue";

describe("espera entre tentativas (ADR-018)", () => {
  const policy = { baseMs: 1000, capMs: 60_000 };
  it("cresce de forma exponencial e respeita o teto", () => {
    expect(retryDelayMs(1, policy, 0)).toBe(500);
    expect(retryDelayMs(2, policy, 0)).toBe(1000);
    expect(retryDelayMs(3, policy, 0)).toBe(2000);
    expect(retryDelayMs(20, policy, 0)).toBe(30_000);
    expect(retryDelayMs(20, policy, 0.999999)).toBeLessThanOrEqual(60_000);
  });
  it("a variacao fica entre metade e o valor cheio", () => {
    for (let a = 1; a <= 8; a++) {
      const full = Math.min(policy.capMs, policy.baseMs * 2 ** (a - 1));
      for (const r of [0, 0.3, 0.7, 0.999999]) {
        const d = retryDelayMs(a, policy, r);
        expect(d).toBeGreaterThanOrEqual(full / 2);
        expect(d).toBeLessThanOrEqual(full);
      }
    }
  });
  it("tentativa invalida vira a primeira", () => {
    expect(retryDelayMs(0, policy, 0)).toBe(500);
    expect(retryDelayMs(-3, policy, 0)).toBe(500);
  });
});
