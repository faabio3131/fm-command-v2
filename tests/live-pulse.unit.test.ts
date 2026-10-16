import { describe, expect, it } from "vitest";
import { LivePulseService } from "../src/application/live/live-pulse-service";
import { LIVE_MAX_BACKOFF_MS, LIVE_POLL_MS, LIVE_TARGET_MS, nextDelayMs, pulseSource, shouldRefresh, type PulseParts } from "../src/domain/live/pulse";
import type { TenantContext } from "../src/domain/security/tenant-context";

const ctx = (tenantId: string): TenantContext => ({ tenantId, userId: "u", role: "owner", correlationId: "c" });
const service = (parts: PulseParts) => new LivePulseService({ read: async () => parts }, async () => ({ kind: "all" }), () => new Date("2026-10-16T12:00:00Z"));

describe("atualização ao vivo: regras da tela", () => {
  it("a primeira marca só inicia; só marca diferente pede nova leitura", () => {
    expect(shouldRefresh(null, "a")).toBe(false);
    expect(shouldRefresh("a", "a")).toBe(false);
    expect(shouldRefresh("a", "b")).toBe(true);
  });
  it("intervalo normal em dia, dobra a cada falha e respeita o teto", () => {
    expect(nextDelayMs(0)).toBe(LIVE_POLL_MS);
    expect(nextDelayMs(1)).toBe(LIVE_POLL_MS * 2);
    expect(nextDelayMs(2)).toBe(LIVE_POLL_MS * 4);
    expect(nextDelayMs(20)).toBe(LIVE_MAX_BACKOFF_MS);
  });
  it("o intervalo normal cabe na meta com folga para desenhar a tela", () => {
    expect(LIVE_POLL_MS).toBeLessThan(LIVE_TARGET_MS);
  });
});

describe("marca de mudança", () => {
  it("muda quando muda o valor de métrica ou o evento; fica igual sem mudança", async () => {
    const base = { metricsLatest: 1000, auditLatest: 2000 };
    const a = await service(base).pulse(ctx("t1"));
    expect((await service(base).pulse(ctx("t1"))).token).toBe(a.token);
    expect((await service({ ...base, metricsLatest: 1001 }).pulse(ctx("t1"))).token).not.toBe(a.token);
    expect((await service({ ...base, auditLatest: 2001 }).pulse(ctx("t1"))).token).not.toBe(a.token);
    expect((await service({ metricsLatest: null, auditLatest: null }).pulse(ctx("t1"))).token).not.toBe(a.token);
  });
  it("empresas diferentes com a mesma data não geram a mesma marca, e a marca não mostra datas", async () => {
    const parts = { metricsLatest: 1760616000000, auditLatest: null };
    const a = await service(parts).pulse(ctx("t1"));
    const b = await service(parts).pulse(ctx("t2"));
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[0-9a-f]{16}$/);
    expect(pulseSource(parts)).toContain("1760616000000");
    expect(a.token).not.toContain("1760616000000");
  });
});
