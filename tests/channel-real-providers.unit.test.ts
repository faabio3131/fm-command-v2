import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelProviderError, type ChannelMessage } from "@/domain/channels/contracts";
import { defaultChannelRegistry } from "@/infrastructure/channels/channel-provider-registry";
import { SmtpChannelProvider } from "@/infrastructure/channels/smtp-channel-provider";
import { WhatsappCloudProvider } from "@/infrastructure/channels/whatsapp-cloud-provider";

const msg = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({ kind: "email", to: "dest@example.com", subject: "Assunto", body: "Corpo", dedupeKey: "k1", ...over });
const outcome = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ChannelProviderError ? `${e.outcome}:${e.code}` : "other"; } };
const closers: (() => void)[] = [];
afterEach(() => { while (closers.length) closers.pop()!(); });

async function smtp(opts: { user?: string; pass?: string; rcptCode?: number; dataCode?: number; hang?: boolean; received?: string[] }) {
  const server = new SMTPServer({
    authOptional: !opts.user, disabledCommands: ["STARTTLS"],
    onAuth(auth, _s, cb) { if (auth.username === opts.user && auth.password === opts.pass) cb(null, { user: "u" }); else cb(Object.assign(new Error("bad"), { responseCode: 535 })); },
    onRcptTo(_a, _s, cb) { if (opts.rcptCode) cb(Object.assign(new Error("rcpt"), { responseCode: opts.rcptCode })); else cb(); },
    onData(stream, _s, cb) {
      let raw = ""; stream.on("data", (c) => (raw += c));
      stream.on("end", () => { opts.received?.push(raw); if (opts.hang) return; if (opts.dataCode) cb(Object.assign(new Error("data"), { responseCode: opts.dataCode })); else cb(); });
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  return (server.server.address() as AddressInfo).port;
}
const smtpProvider = (port: number, user: string | null = null, timeoutMs = 3000) => new SmtpChannelProvider({ host: "127.0.0.1", port, secure: false, requireTls: false, user, timeoutMs });

describe("SMTP", () => {
  it("entrega, com Message-ID estável e credencial", async () => {
    const received: string[] = [];
    const port = await smtp({ user: "bot", pass: "senha-boa", received });
    const r = await smtpProvider(port, "bot").send(msg(), { from: "alertas@empresa.com" }, { apiKey: "senha-boa" });
    expect(r.providerMessageId).toMatch(/@fm-command>$/);
    expect(received[0]).toContain("Subject: Assunto");
    expect(received[0]).toContain(r.providerMessageId);
  });
  it("credencial errada ou ausente é recusa", async () => {
    const port = await smtp({ user: "bot", pass: "senha-boa" });
    expect(await outcome(smtpProvider(port, "bot").send(msg(), { from: "a@b.com" }, { apiKey: "errada" }))).toBe("rejected:channel.credential_rejected");
    expect(await outcome(smtpProvider(port, "bot").send(msg(), { from: "a@b.com" }, {}))).toBe("rejected:channel.credential_rejected");
  });
  it("destinatário recusado 5xx é recusa; 4xx é transitório", async () => {
    expect(await outcome(smtpProvider(await smtp({ rcptCode: 550 })).send(msg(), { from: "a@b.com" }, {}))).toBe("rejected:channel.recipient_rejected");
    expect(await outcome(smtpProvider(await smtp({ rcptCode: 451 })).send(msg(), { from: "a@b.com" }, {}))).toBe("transient:channel.provider_unavailable");
  });
  it("servidor fora do ar é transitório", async () => {
    const port = await smtp({}); closers.pop()!();
    await new Promise((r) => setTimeout(r, 50));
    expect(await outcome(smtpProvider(port).send(msg(), { from: "a@b.com" }, {}))).toBe("transient:channel.provider_unavailable");
  });
  it("silêncio depois dos dados é incerto: nunca reenviar sozinho", async () => {
    const port = await smtp({ hang: true });
    expect(await outcome(smtpProvider(port, null, 600).send(msg(), { from: "a@b.com" }, {}))).toBe("uncertain:channel.response_lost");
  });
});

async function http(handler: (body: unknown, auth: string | undefined, url: string) => { status: number; json?: unknown; hang?: boolean }) {
  const calls: { body: unknown; auth?: string; url: string }[] = [];
  const server: Server = createServer((req, res) => {
    let raw = ""; req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ body, auth: req.headers.authorization, url: req.url ?? "" });
      const r = handler(body, req.headers.authorization, req.url ?? "");
      if (r.hang) return;
      res.writeHead(r.status, { "content-type": "application/json" }); res.end(JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => { server.closeAllConnections(); server.close(); });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v21.0`, calls };
}
const wa = (base: string, timeoutMs = 3000) => new WhatsappCloudProvider({ apiBase: base, timeoutMs });
const wmsg = msg({ kind: "whatsapp", to: "+5511999990000", subject: undefined });

describe("WhatsApp Cloud API", () => {
  it("envia texto no formato da API e devolve o id", async () => {
    const { base, calls } = await http(() => ({ status: 200, json: { messages: [{ id: "wamid.ABC" }] } }));
    expect(await wa(base).send(wmsg, { from: "1234567890" }, { apiKey: "tok" })).toEqual({ providerMessageId: "wamid.ABC" });
    expect(calls[0]).toMatchObject({ url: "/v21.0/1234567890/messages", auth: "Bearer tok", body: { messaging_product: "whatsapp", to: "5511999990000", type: "text", text: { body: "Corpo" } } });
  });
  it("mapeia respostas: 429/5xx transitório, 401 e erro 190 credencial, fora da janela recusa, limite de taxa transitório", async () => {
    const cases: [number, unknown, string][] = [
      [429, {}, "transient:channel.provider_unavailable"], [503, {}, "transient:channel.provider_unavailable"],
      [401, {}, "rejected:channel.credential_rejected"], [400, { error: { code: 190 } }, "rejected:channel.credential_rejected"],
      [400, { error: { code: 131047 } }, "rejected:channel.recipient_rejected"], [400, { error: { code: 130429 } }, "transient:channel.provider_unavailable"],
      [200, {}, "uncertain:channel.response_lost"],
    ];
    for (const [status, json, expected] of cases) {
      const { base } = await http(() => ({ status, json }));
      expect(await outcome(wa(base).send(wmsg, { from: "1" }, { apiKey: "tok" }))).toBe(expected);
    }
  });
  it("sem token é recusa sem chamar a rede; conexão recusada é transitória; tempo esgotado é incerto", async () => {
    expect(await outcome(wa("http://127.0.0.1:9/v21.0").send(wmsg, { from: "1" }, {}))).toBe("rejected:channel.credential_rejected");
    expect(await outcome(wa("http://127.0.0.1:9/v21.0").send(wmsg, { from: "1" }, { apiKey: "t" }))).toBe("transient:channel.provider_unavailable");
    const { base } = await http(() => ({ status: 200, hang: true }));
    expect(await outcome(wa(base, 300).send(wmsg, { from: "1" }, { apiKey: "t" }))).toBe("uncertain:channel.response_lost");
  });
});

describe("registro", () => {
  it("provedores reais só existem com a configuração própria", () => {
    expect(defaultChannelRegistry({}).catalog()).toEqual([]);
    const cat = defaultChannelRegistry({ FMCC_SMTP_HOST: "smtp.local", FMCC_SMTP_USER: "u", FMCC_WHATSAPP_CLOUD_API_BASE: "https://x/v21.0" }).catalog();
    expect(cat).toEqual([
      { id: "smtp", kind: "email", credential: "api_key", simulated: false },
      { id: "whatsapp_cloud", kind: "whatsapp", credential: "api_key", simulated: false },
    ]);
    expect(defaultChannelRegistry({ FMCC_SMTP_HOST: "smtp.local" }).catalog()[0].credential).toBe("none");
  });
});
