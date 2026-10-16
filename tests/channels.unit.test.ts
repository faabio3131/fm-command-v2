import { describe, expect, it } from "vitest";
import { toChannelMessage, contentHash } from "@/domain/channels/alert-message";
import { ChannelProviderError } from "@/domain/channels/contracts";
import { MAX_ATTEMPTS, backoffMs, decideAfterFailure, normalizeAddress, severityMeets } from "@/domain/channels/policy";
import { defaultChannelRegistry } from "@/infrastructure/channels/channel-provider-registry";
import { SimulatedChannelProvider } from "@/infrastructure/channels/simulated-channel-provider";
import { roleHasPermission } from "@/domain/security/permissions";

const NOW = new Date("2026-10-16T12:00:00Z");

describe("política dos canais", () => {
  it("gravidade mínima: alcança igual ou acima", () => {
    expect(severityMeets("critical", "warning")).toBe(true);
    expect(severityMeets("warning", "warning")).toBe(true);
    expect(severityMeets("info", "warning")).toBe(false);
  });
  it("normaliza e valida endereços por canal", () => {
    expect(normalizeAddress("email", "  Ana@Empresa.com ")).toBe("ana@empresa.com");
    expect(normalizeAddress("email", "sem-arroba")).toBeNull();
    expect(normalizeAddress("whatsapp", "+55 (11) 91234-5678")).toBe("+5511912345678");
    expect(normalizeAddress("whatsapp", "11912345678")).toBeNull();
    expect(normalizeAddress("email", 42)).toBeNull();
  });
  it("incerto nunca é reenviado; recusado não repete; transitório espera e tem limite", () => {
    expect(decideAfterFailure(new ChannelProviderError("x", "uncertain"), 1, NOW)).toEqual({ status: "uncertain", nextAttemptAt: null });
    expect(decideAfterFailure(new ChannelProviderError("x", "rejected"), 1, NOW).status).toBe("failed");
    const retry = decideAfterFailure(new ChannelProviderError("x", "transient"), 1, NOW);
    expect(retry.status).toBe("failed_transient");
    expect(retry.nextAttemptAt!.getTime()).toBe(NOW.getTime() + backoffMs(1));
    expect(decideAfterFailure(new ChannelProviderError("x", "transient"), MAX_ATTEMPTS, NOW).status).toBe("failed");
    expect(backoffMs(2)).toBe(backoffMs(1) * 2);
    expect(backoffMs(99)).toBeLessThanOrEqual(30 * 60_000);
  });
  it("WhatsApp leva o assunto na primeira linha; e-mail tem assunto próprio", () => {
    const text = { subject: "Assunto", body: "Corpo" };
    expect(toChannelMessage("whatsapp", "+5511912345678", text, "k").body).toBe("Assunto\n\nCorpo");
    expect(toChannelMessage("email", "a@b.co", text, "k").subject).toBe("Assunto");
    expect(contentHash(text)).toBe(contentHash({ ...text }));
  });
  it("permissões: analista só lê; viewer não vê", () => {
    expect(roleHasPermission("admin", "channel:write")).toBe(true);
    expect(roleHasPermission("analyst", "channel:read")).toBe(true);
    expect(roleHasPermission("analyst", "channel:write")).toBe(false);
    expect(roleHasPermission("viewer", "channel:read")).toBe(false);
  });
});

describe("provedor simulado e registro", () => {
  const msg = (to: string) => ({ kind: "email" as const, to, subject: "s", body: "b", dedupeKey: "k1" });
  it("o mesmo envio aceito duas vezes não duplica", async () => {
    const p = new SimulatedChannelProvider("simulated_email", "email");
    const a = await p.send(msg("a@b.co"), { from: "x@y.co" }, {});
    const b = await p.send(msg("a@b.co"), { from: "x@y.co" }, {});
    expect(b.providerMessageId).toBe(a.providerMessageId);
    expect(p.accepted).toHaveLength(1);
  });
  it("cada marcador provoca o seu desfecho", async () => {
    const p = new SimulatedChannelProvider("simulated_email", "email");
    await expect(p.send(msg("a+reject@b.co"), { from: "x" }, {})).rejects.toMatchObject({ outcome: "rejected" });
    await expect(p.send(msg("a+uncertain@b.co"), { from: "x" }, {})).rejects.toMatchObject({ outcome: "uncertain" });
    const t = msg("a+transient2@b.co");
    await expect(p.send(t, { from: "x" }, {})).rejects.toMatchObject({ outcome: "transient" });
    await expect(p.send(t, { from: "x" }, {})).rejects.toMatchObject({ outcome: "transient" });
    await expect(p.send(t, { from: "x" }, {})).resolves.toBeTruthy();
  });
  it("provedor com chave recusa chave curta", async () => {
    const p = new SimulatedChannelProvider("k", "email", "api_key");
    await expect(p.send(msg("a@b.co"), { from: "x" }, { apiKey: "curta" })).rejects.toMatchObject({ code: "channel.credential_rejected" });
  });
  it("simulador só existe com a chave de ambiente, e em produção só com a segunda chave", () => {
    expect(defaultChannelRegistry({}).catalog()).toHaveLength(0);
    expect(defaultChannelRegistry({ FMCC_CHANNEL_SIMULATED: "1" }).catalog().length).toBeGreaterThan(0);
    expect(defaultChannelRegistry({ FMCC_CHANNEL_SIMULATED: "1", NODE_ENV: "production" }).catalog()).toHaveLength(0);
    expect(defaultChannelRegistry({ FMCC_CHANNEL_SIMULATED: "1", NODE_ENV: "production", FMCC_CHANNEL_ALLOW_SIMULATED: "1" }).catalog().length).toBeGreaterThan(0);
  });
});
