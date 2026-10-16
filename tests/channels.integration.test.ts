import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ChannelInputError, ChannelNotFoundError, ChannelService, type ChannelAudit, type CredentialWriter } from "@/application/channels/channel-service";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";
import { PostgresChannelRepository } from "@/infrastructure/channels/postgres-channel-repository";
import { defaultChannelRegistry } from "@/infrastructure/channels/channel-provider-registry";
import { SimulatedChannelProvider } from "@/infrastructure/channels/simulated-channel-provider";
import { db } from "@/infrastructure/db/client";
import { channelConfigs, channelDeliveries, channelRecipients } from "@/infrastructure/db/channel-schema";
import { CredentialNotFoundError } from "@/domain/integration/credentials";

const A = "chan-it-a";
const B = "chan-it-b";
const SECRET = "chave-super-secreta-123";
const text = { subject: "[WARNING] Incidentes", body: "Valor 12 acima de 10" };
const ctx = (tenantId: string, role: TenantContext["role"] = "admin"): TenantContext => ({ tenantId, userId: "user-1", role, correlationId: "corr-1" });

let clock = new Date("2026-10-16T12:00:00Z");
const vault = new Map<string, string>();
const auditLog: { action: string; metadata: Record<string, unknown> }[] = [];

function build() {
  const registry = defaultChannelRegistry({ FMCC_CHANNEL_SIMULATED: "1" });
  const credentials: CredentialWriter = {
    async save(tenantId, ref, c) { vault.set(`${tenantId}|${ref}`, c.apiKey); },
    async resolve(tenantId, ref) {
      const apiKey = vault.get(`${tenantId}|${ref}`);
      if (!apiKey) throw new CredentialNotFoundError();
      return { kind: "api_key", apiKey };
    },
  };
  const audit: ChannelAudit = { async record(i) { auditLog.push({ action: i.action, metadata: i.metadata }); } };
  const service = new ChannelService({ repository: new PostgresChannelRepository(), registry, credentials, audit, now: () => clock });
  const provider = (id: string) => registry.get(id.includes("whatsapp") ? "whatsapp" : "email", id) as SimulatedChannelProvider;
  return { service, provider };
}

async function clean() {
  for (const t of [A, B]) {
    await db.delete(channelDeliveries).where(eq(channelDeliveries.tenantId, t));
    await db.delete(channelRecipients).where(eq(channelRecipients.tenantId, t));
    await db.delete(channelConfigs).where(eq(channelConfigs.tenantId, t));
  }
}
beforeEach(async () => { clock = new Date("2026-10-16T12:00:00Z"); vault.clear(); auditLog.length = 0; await clean(); });
afterAll(clean);

async function setup(service: ChannelService, tenant = A, minSeverity = "warning", address = "ana@empresa.com") {
  await service.saveConfig(ctx(tenant), { kind: "email", providerId: "simulated_email", sender: "alertas@fm.test", enabled: true, minSeverity });
  await service.addRecipient(ctx(tenant), { kind: "email", address });
}

describe("canais: configuração", () => {
  it("só quem tem channel:write altera; analista lê; viewer não vê", async () => {
    const { service } = build();
    await expect(service.saveConfig(ctx(A, "analyst"), { kind: "email", providerId: "simulated_email", sender: "a@b.co", enabled: true, minSeverity: "info" })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.overview(ctx(A, "analyst"))).resolves.toBeTruthy();
    await expect(service.overview(ctx(A, "viewer"))).rejects.toBeInstanceOf(PermissionDeniedError);
  });
  it("recusa provedor inexistente e endereço inválido", async () => {
    const { service } = build();
    await expect(service.saveConfig(ctx(A), { kind: "email", providerId: "nao_existe", sender: "a@b.co", enabled: true, minSeverity: "info" })).rejects.toBeInstanceOf(ChannelInputError);
    await expect(service.addRecipient(ctx(A), { kind: "whatsapp", address: "123" })).rejects.toBeInstanceOf(ChannelInputError);
  });
  it("chave do provedor vai ao cofre; não aparece no banco de configuração, no panorama nem no audit", async () => {
    const { service } = build();
    await expect(service.saveConfig(ctx(A), { kind: "email", providerId: "simulated_email_keyed", sender: "a@b.co", enabled: true, minSeverity: "info" })).rejects.toBeInstanceOf(ChannelInputError);
    await service.saveConfig(ctx(A), { kind: "email", providerId: "simulated_email_keyed", sender: "a@b.co", enabled: true, minSeverity: "info", apiKey: SECRET });
    await service.saveConfig(ctx(A), { kind: "email", providerId: "simulated_email_keyed", sender: "novo@b.co", enabled: true, minSeverity: "info" }); // mantém a chave
    expect([...vault.values()]).toEqual([SECRET]);
    const rows = JSON.stringify(await db.select().from(channelConfigs).where(eq(channelConfigs.tenantId, A)));
    expect(rows).not.toContain(SECRET);
    expect(JSON.stringify(await service.overview(ctx(A)))).not.toContain(SECRET);
    expect(JSON.stringify(auditLog)).not.toContain(SECRET);
    expect(auditLog.map((a) => a.action)).toContain("channel.config.updated");
  });
  it("audit do destinatário não guarda o endereço", async () => {
    const { service } = build();
    await service.addRecipient(ctx(A), { kind: "email", address: "pessoa@empresa.com" });
    expect(JSON.stringify(auditLog)).not.toContain("pessoa@empresa.com");
  });
  it("isolamento entre empresas", async () => {
    const { service } = build();
    await setup(service, A);
    const other = await service.overview(ctx(B));
    expect(other.configs).toHaveLength(0);
    expect(other.recipients).toHaveLength(0);
    const [rec] = (await service.overview(ctx(A))).recipients;
    await expect(service.removeRecipient(ctx(B), rec.id)).rejects.toBeInstanceOf(ChannelNotFoundError);
    await expect(service.removeRecipient(ctx(A), "nao-e-uuid")).rejects.toBeInstanceOf(ChannelNotFoundError);
  });
});

describe("canais: alertas e recibos", () => {
  const notice = (severity: "info" | "warning" | "critical" = "critical", id = "occ-1") => ({ tenantId: A, occurrenceId: id, severity });

  it("alerta que alcança a gravidade mínima é enviado uma vez e deixa recibo", async () => {
    const { service, provider } = build();
    await setup(service);
    expect(await service.notifyAlert(notice(), text)).toEqual({ queued: 1, skipped: 1 }) // WhatsApp não configurado nesta empresa;
    const [d] = (await service.overview(ctx(A))).deliveries;
    expect(d.status).toBe("sent");
    expect(d.providerMessageId).toMatch(/^sim-/);
    expect(provider("simulated_email").accepted.filter((m) => m.message.to === "ana@empresa.com")).toHaveLength(1);
  });
  it("o mesmo alerta notificado duas vezes não envia de novo", async () => {
    const { service, provider } = build();
    await setup(service);
    const before = provider("simulated_email").accepted.length;
    await service.notifyAlert(notice(), text);
    expect(await service.notifyAlert(notice(), text)).toEqual({ queued: 0, skipped: 1 });
    expect(provider("simulated_email").accepted.length - before).toBe(1);
    expect((await service.overview(ctx(A))).deliveries).toHaveLength(1);
  });
  it("gravidade abaixo do mínimo, canal desligado e destinatário desligado não enviam", async () => {
    const { service } = build();
    await setup(service, A, "critical");
    await service.notifyAlert(notice("warning", "occ-low"), text);
    expect((await service.overview(ctx(A))).deliveries).toHaveLength(0);
    await service.saveConfig(ctx(A), { kind: "email", providerId: "simulated_email", sender: "a@b.co", enabled: false, minSeverity: "info" });
    await service.notifyAlert(notice("critical", "occ-off"), text);
    expect((await service.overview(ctx(A))).deliveries).toHaveLength(0);
    await service.saveConfig(ctx(A), { kind: "email", providerId: "simulated_email", sender: "a@b.co", enabled: true, minSeverity: "info" });
    const [rec] = (await service.overview(ctx(A))).recipients;
    await service.setRecipientEnabled(ctx(A), rec.id, false);
    await service.notifyAlert(notice("critical", "occ-rec"), text);
    expect((await service.overview(ctx(A))).deliveries).toHaveLength(0);
  });
  it("falha transitória reagenda com espera e depois entrega; só uma mensagem sai", async () => {
    const { service, provider } = build();
    await setup(service, A, "info", "tr+transient2@empresa.com");
    await service.notifyAlert(notice("warning", "occ-tr"), text);
    let [d] = (await service.overview(ctx(A))).deliveries;
    expect(d.status).toBe("failed_transient");
    expect(d.nextAttemptAt!.getTime()).toBeGreaterThan(clock.getTime());
    const retry = () => service.dispatch({ texts: new Map(), rebuild: async () => text });
    expect((await retry()).sent).toBe(0); // ainda não venceu
    clock = new Date(clock.getTime() + 60_000);
    expect((await retry()).retry).toBe(1);
    clock = new Date(clock.getTime() + 10 * 60_000);
    expect((await retry()).sent).toBe(1);
    [d] = (await service.overview(ctx(A))).deliveries;
    expect(d.status).toBe("sent");
    expect(d.attempts).toBe(3);
    expect(provider("simulated_email").accepted.filter((m) => m.message.to.startsWith("tr+transient2"))).toHaveLength(1);
  });
  it("recusado fica 'failed' sem repetir; incerto nunca é reenviado", async () => {
    const { service } = build();
    await setup(service, A, "info", "x+reject@empresa.com");
    await service.addRecipient(ctx(A), { kind: "email", address: "y+uncertain@empresa.com" });
    await service.notifyAlert(notice("warning", "occ-bad"), text);
    const byRecipient = Object.fromEntries((await service.overview(ctx(A))).deliveries.map((d) => [d.recipient, d]));
    expect(byRecipient["x+reject@empresa.com"].status).toBe("failed");
    expect(byRecipient["y+uncertain@empresa.com"].status).toBe("uncertain");
    clock = new Date(clock.getTime() + 24 * 3_600_000);
    const again = await service.dispatch({ texts: new Map(), rebuild: async () => text });
    expect(again).toEqual({ sent: 0, failed: 0, uncertain: 0, retry: 0 });
  });
  it("envio preso em 'sending' além do prazo vira incerto (não reenvia)", async () => {
    const { service } = build();
    await setup(service);
    const repo = new PostgresChannelRepository();
    const { delivery } = await repo.enqueue({ tenantId: A, kind: "email", providerId: "simulated_email", recipient: "ana@empresa.com", dedupeKey: "alert:stuck", subject: "s", contentHash: "h", sourceType: "alert_occurrence", sourceId: "stuck", availableAt: clock });
    await repo.claimDue(10, clock, [delivery.id]); // processo "caiu" depois de pegar
    clock = new Date(clock.getTime() + 6 * 60_000);
    await service.dispatch({ texts: new Map(), rebuild: async () => text });
    expect((await repo.findDelivery(A, delivery.id))?.status).toBe("uncertain");
  });
  it("sem credencial no cofre, o envio é recusado sem vazar nada", async () => {
    const { service } = build();
    await service.saveConfig(ctx(A), { kind: "email", providerId: "simulated_email_keyed", sender: "a@b.co", enabled: true, minSeverity: "info", apiKey: SECRET });
    await service.addRecipient(ctx(A), { kind: "email", address: "ana@empresa.com" });
    vault.clear();
    await service.notifyAlert(notice("warning", "occ-nokey"), text);
    const [d] = (await service.overview(ctx(A))).deliveries;
    expect(d.status).toBe("failed");
    expect(d.errorCode).toBe("channel.credential_missing");
  });
  it("teste manual gera recibo e cada clique é um envio novo", async () => {
    const { service } = build();
    await setup(service);
    const [rec] = (await service.overview(ctx(A))).recipients;
    expect((await service.sendTest(ctx(A), rec.id, text, "n1")).status).toBe("sent");
    expect((await service.sendTest(ctx(A), rec.id, text, "n2")).status).toBe("sent");
    expect((await service.overview(ctx(A))).deliveries).toHaveLength(2);
  });
  it("WhatsApp usa o mesmo caminho", async () => {
    const { service, provider } = build();
    await service.saveConfig(ctx(A), { kind: "whatsapp", providerId: "simulated_whatsapp", sender: "+5511999990000", enabled: true, minSeverity: "info" });
    await service.addRecipient(ctx(A), { kind: "whatsapp", address: "+55 11 91234-5678" });
    await service.notifyAlert(notice("critical", "occ-wa"), text);
    const sent = provider("simulated_whatsapp").accepted.find((m) => m.message.to === "+5511912345678");
    expect(sent?.message.body).toBe(`${text.subject}\n\n${text.body}`);
  });
});
