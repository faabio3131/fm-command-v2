import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { rebuildAgentDraftText, workReader } from "@/application/agents/agent-composition";
import { AgentNotFoundError, AgentRefusedError, AgentService, AgentStateError } from "@/application/agents/agent-service";
import { ChannelService } from "@/application/channels/channel-service";
import { createAiTaskHandler } from "@/application/core/ai-task-handler";
import { ProviderRouter } from "@/application/core/provider-router";
import { processOne } from "@/application/core/work-worker";
import { PermissionDeniedError, type TenantContext } from "@/domain/security/tenant-context";
import { PostgresAgentRepository } from "@/infrastructure/agents/postgres-agent-repository";
import { defaultChannelRegistry } from "@/infrastructure/channels/channel-provider-registry";
import { PostgresChannelRepository } from "@/infrastructure/channels/postgres-channel-repository";
import type { SimulatedChannelProvider } from "@/infrastructure/channels/simulated-channel-provider";
import { PostgresAiConfig } from "@/infrastructure/core/postgres-ai-config";
import { OpenAiCompatibleProvider } from "@/infrastructure/core/openai-compatible-provider";
import { PostgresWorkQueue } from "@/infrastructure/core/postgres-work-queue";
import { pool, db } from "@/infrastructure/db/client";
import { agentBudgets, agentDrafts } from "@/infrastructure/db/agent-schema";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import { channelConfigs, channelDeliveries, channelRecipients } from "@/infrastructure/db/channel-schema";
import { CredentialNotFoundError } from "@/domain/integration/credentials";

const A = "agente-it-a";
const B = "agente-it-b";
const TENANTS = [A, B];
const ctx = (tenantId: string, role: TenantContext["role"] = "owner"): TenantContext => ({ tenantId, userId: `u-${role}`, role, correlationId: "c" });
const LINES = ["Frete faturado: R$ 1.750,50", "Entregas atrasadas: 3", "Custo de manutenção: indisponível"];

let providerReply = "A receita foi de R$ 1.750,50 e há 3 entregas atrasadas. A manutenção está indisponível.";
let providerStatus = 200;
let providerHits = 0;
let server: Server;
let providerUrl = "";
// 1000 tokens de entrada e 500 de saída a 300 e 1500 por milhão (USD, unidade menor): custo exato esperado abaixo.
const COST_MICRO = Math.round((1000 * 300 + 500 * 1500) ); // = 1.050.000 micro-centavos = 1,05 centavo

const fastRetry = { baseMs: 5, capMs: 20 };
const queue = new PostgresWorkQueue(pool, fastRetry, () => 0.5);
const repository = new PostgresAgentRepository();
let clock = new Date("2026-10-14T15:00:00Z"); // quarta, semana 2026-W42
const vault = new Map<string, string>();

function channels() {
  const registry = defaultChannelRegistry({ FMCC_CHANNEL_SIMULATED: "1" });
  const service = new ChannelService({
    repository: new PostgresChannelRepository(), registry, now: () => clock,
    credentials: { async save() {}, async resolve() { throw new CredentialNotFoundError(); } },
    audit: { async record() {} },
  });
  return { service, provider: registry.get("email", "simulated_email") as SimulatedChannelProvider };
}
const sharedChannels = channels();

const audits: string[] = [];
function agent(now: () => Date = () => clock, numberLines: () => Promise<string[]> = async () => LINES, staleDraftMs?: number) {
  return new AgentService({
    repository, queue, work: workReader, channels: sharedChannels.service, numberLines,
    tenantProfile: async () => ({ timeZone: "America/Sao_Paulo", locale: "pt-BR" }),
    audit: { async record(i) { audits.push(`${i.tenantId}:${i.action}`); } }, now, staleDraftMs,
  });
}

const router = () => new ProviderRouter({
  config: new PostgresAiConfig(pool), configTtlMs: 0, random: () => 0,
  makeProvider: (c) => new OpenAiCompatibleProvider(c, { AI_KEY_AG: "so-no-ambiente", FMCC_AI_ALLOW_LOCAL_PROVIDERS: "1" }),
});
async function runWorker() {
  const handlers = { synthesis: createAiTaskHandler(router()) };
  for (let idle = 0; idle < 25;) {
    const o = await processOne(queue, { workerId: "w", leaseMs: 5000, maxPerTenant: 5, handlers });
    if (o === "idle") {
      idle++; await new Promise((r) => setTimeout(r, 20));
      const left = await pool.query("SELECT 1 FROM fmcc_work_item WHERE tenant_id = ANY($1) AND state IN ('queued','running') LIMIT 1", [TENANTS]);
      if (left.rowCount === 0) return;
    } else idle = 0;
  }
}

async function clean() {
  await pool.query("DELETE FROM fmcc_work_item WHERE tenant_id = ANY($1)", [TENANTS]);
  await pool.query("DELETE FROM fmcc_ai_usage WHERE tenant_id = ANY($1)", [TENANTS]);
  await db.delete(agentDrafts).where(inArray(agentDrafts.tenantId, TENANTS));
  await db.delete(agentBudgets).where(inArray(agentBudgets.tenantId, TENANTS));
  await db.delete(channelDeliveries).where(inArray(channelDeliveries.tenantId, TENANTS));
  await db.delete(channelRecipients).where(inArray(channelRecipients.tenantId, TENANTS));
  await db.delete(channelConfigs).where(inArray(channelConfigs.tenantId, TENANTS));
  await db.delete(auditEvents).where(inArray(auditEvents.tenantId, TENANTS));
}
const workItems = async (t: string) => (await pool.query("SELECT id FROM fmcc_work_item WHERE tenant_id=$1", [t])).rowCount ?? 0;
const deliveries = async (t: string) => db.select().from(channelDeliveries).where(eq(channelDeliveries.tenantId, t));
const budget = (t: string, over: Partial<{ enabled: boolean; capMinor: number; reserveMinor: number; currency: string }> = {}, role: TenantContext["role"] = "owner") =>
  agent().setBudget(ctx(t, role), { enabled: true, capMinor: 100, reserveMinor: 10, currency: "USD", ...over });

beforeAll(async () => {
  process.env.FMCC_AI_ALLOW_LOCAL_PROVIDERS = "1";
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      providerHits++;
      if (providerStatus !== 200) return void res.writeHead(providerStatus).end("x");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: "ag-m", choices: [{ message: { content: providerReply } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }));
    });
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  providerUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await pool.query("DELETE FROM fmcc_ai_route WHERE provider_id = 'it-ag'");
  await pool.query("DELETE FROM fmcc_ai_provider WHERE id = 'it-ag'");
  await pool.query(`INSERT INTO fmcc_ai_provider(id,base_url,model,secret_ref,enabled,timeout_ms,currency,input_minor_per_million,output_minor_per_million) VALUES('it-ag',$1,'ag-m','env://AI_KEY_AG',true,5000,'USD',300,1500)`, [providerUrl]);
  await pool.query("INSERT INTO fmcc_ai_route(task_type,tenant_id,provider_id,role,weight,max_concurrent) VALUES('synthesis',NULL,'it-ag','primary',1,8)");
});
afterAll(async () => {
  await clean();
  await pool.query("DELETE FROM fmcc_ai_route WHERE provider_id = 'it-ag'");
  await pool.query("DELETE FROM fmcc_ai_provider WHERE id = 'it-ag'");
  server.closeAllConnections(); server.close();
});
beforeEach(async () => {
  await clean(); vault.clear(); audits.length = 0; providerHits = 0; providerStatus = 200;
  providerReply = "A receita foi de R$ 1.750,50 e há 3 entregas atrasadas. A manutenção está indisponível.";
  clock = new Date("2026-10-14T15:00:00Z"); sharedChannels.provider.accepted.length = 0;
  await sharedChannels.service.saveConfig(ctx(A), { kind: "email", providerId: "simulated_email", sender: "agente@fm.test", enabled: true, minSeverity: "info" });
  await sharedChannels.service.addRecipient(ctx(A), { kind: "email", address: "diretoria@empresa.com" });
});
afterEach(() => undefined);

describe("agente piloto: orçamento", () => {
  it("sem orçamento ou desligado, nada é enfileirado nem gasto", async () => {
    await expect(agent().requestDraft(ctx(A))).rejects.toMatchObject({ reason: "agent.disabled" });
    await budget(A, { enabled: false });
    await expect(agent().requestDraft(ctx(A))).rejects.toBeInstanceOf(AgentRefusedError);
    expect(await workItems(A)).toBe(0);
    expect(providerHits).toBe(0);
  });

  it("só o proprietário altera o orçamento; valores inválidos são recusados", async () => {
    await expect(budget(A, {}, "admin")).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(budget(A, {}, "analyst")).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(budget(A, { capMinor: -1 })).rejects.toThrow("agent.input_invalid:capMinor");
    await expect(budget(A, { reserveMinor: 101 })).rejects.toThrow("agent.input_invalid:reserveMinor");
    await expect(budget(A, { currency: "usd" })).rejects.toThrow("agent.input_invalid:currency");
    await budget(A);
    expect(audits).toContain(`${A}:agent.budget_changed`);
  });

  it("o custo real é o do provedor, gravado no rascunho; a reserva é liberada e o gasto do mês soma só o real", async () => {
    await budget(A);
    const { draft } = await agent().requestDraft(ctx(A));
    expect(draft.status).toBe("generating");
    expect((await agent().overview(ctx(A))).usage).toMatchObject({ inFlight: 1, spentMicroMinor: 0 });
    await runWorker();
    const o = await agent().overview(ctx(A));
    expect(o.drafts[0]).toMatchObject({ status: "ready", costMicroMinor: COST_MICRO, currency: "USD" });
    expect(o.usage).toMatchObject({ inFlight: 0, spentMicroMinor: COST_MICRO, currencyMismatch: false });
  });

  it("estourar o teto: pedido além do que cabe é recusado sem chamar o provedor", async () => {
    await budget(A, { capMinor: 2, reserveMinor: 2 }); // cabe uma reserva só
    await agent().requestDraft(ctx(A));
    await runWorker();
    const hitsAfterFirst = providerHits;
    expect((await agent().overview(ctx(A))).usage?.spentMicroMinor).toBe(COST_MICRO); // 1,05 centavo gastos de 2
    clock = new Date("2026-10-21T15:00:00Z"); // outra semana, mesmo mês
    await expect(agent().requestDraft(ctx(A))).rejects.toMatchObject({ reason: "agent.budget_exhausted" }); // 1,05 + 2 > 2
    expect(providerHits).toBe(hitsAfterFirst);
    expect(await workItems(A)).toBe(1);
    expect(audits).toContain(`${A}:agent.draft_refused`);
  });

  it("pedidos simultâneos nunca passam do teto: com espaço para 2 reservas, só 2 entram", async () => {
    await budget(A, { capMinor: 20, reserveMinor: 10 });
    // Relógios falsos à frente do real faziam o `sync` de um pedido expirar o rascunho ainda em criação de outro (120 s sem tarefa), devolvendo espaço no teto: instável. Aqui a expiração fica desligada.
    const weeks = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-10-07"]; // 4 semanas distintas + 1 repetida
    const results = await Promise.allSettled(weeks.map((d) => agent(() => new Date(`${d}T15:00:00Z`), undefined, 3_600_000_000).requestDraft(ctx(A))));
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    const created = ok.filter((r) => (r as PromiseFulfilledResult<{ created: boolean }>).value.created);
    expect(created).toHaveLength(2);
    expect(await workItems(A)).toBe(2);
    expect(refused.every((r) => (r as PromiseRejectedResult).reason.reason === "agent.budget_exhausted")).toBe(true);
  });

  it("custo em moeda diferente da do orçamento trava novos rascunhos em vez de comparar errado", async () => {
    await budget(A, { currency: "BRL" });
    await agent().requestDraft(ctx(A));
    await runWorker(); // o provedor cobra em USD
    clock = new Date("2026-10-21T15:00:00Z");
    await expect(agent().requestDraft(ctx(A))).rejects.toMatchObject({ reason: "agent.budget_currency_mismatch" });
  });

  it("outro mês, outro gasto: o teto é mensal", async () => {
    await budget(A, { capMinor: 2, reserveMinor: 2 });
    await agent().requestDraft(ctx(A)); await runWorker();
    clock = new Date("2026-11-04T15:00:00Z");
    await expect(agent().requestDraft(ctx(A))).resolves.toMatchObject({ created: true });
  });
});

describe("agente piloto: confirmação humana", () => {
  async function ready() {
    await budget(A);
    const { draft } = await agent().requestDraft(ctx(A));
    await runWorker();
    return draft.id;
  }

  it("rascunho pronto não envia nada; só a aprovação libera, e só quem tem permissão", async () => {
    const id = await ready();
    expect((await agent().overview(ctx(A))).drafts[0]).toMatchObject({ status: "ready", draftBody: expect.stringContaining("1.750,50"), unverifiedNumbers: [] });
    expect(await deliveries(A)).toHaveLength(0);
    expect(sharedChannels.provider.accepted).toHaveLength(0);
    await expect(agent().approve(ctx(A, "analyst"), id)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(agent().approve(ctx(A, "viewer"), id)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(agent().requestDraft(ctx(A, "analyst"))).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await deliveries(A)).toHaveLength(0);
  });

  it("aprovar envia uma vez pelo canal, com o texto aprovado (editado); repetir não duplica", async () => {
    const id = await ready();
    const edited = { subject: "Resumo da diretoria", body: "Texto revisado por mim. Frete R$ 1.750,50." };
    expect(await agent().approve(ctx(A, "admin"), id, edited)).toEqual({ queued: 1 });
    expect(await agent().approve(ctx(A, "admin"), id, { subject: "outro", body: "outro" })).toEqual({ queued: 0 }); // já enviado: nada novo, e o texto do segundo pedido é ignorado
    expect(await deliveries(A)).toHaveLength(1);
    expect(sharedChannels.provider.accepted).toHaveLength(1);
    expect(sharedChannels.provider.accepted[0]!.message).toMatchObject({ to: "diretoria@empresa.com", subject: "Resumo da diretoria", body: "Texto revisado por mim. Frete R$ 1.750,50." });
    const [row] = await db.select().from(agentDrafts).where(eq(agentDrafts.id, id));
    expect(row).toMatchObject({ status: "sent", sentQueued: 1, decidedBy: "u-admin", finalBody: "Texto revisado por mim. Frete R$ 1.750,50." });
    expect(audits.filter((a) => a === `${A}:agent.draft_approved`)).toHaveLength(1);
    expect(audits).toContain(`${A}:agent.draft_sent`);
  });

  it("reenvio de um recibo usa sempre o texto aprovado, e nunca o de um rascunho não aprovado", async () => {
    const id = await ready();
    expect(await rebuildAgentDraftText(A, id)).toBeNull(); // ainda não aprovado
    await agent().approve(ctx(A), id, { subject: "Assunto final", body: "Corpo final 3." });
    expect(await rebuildAgentDraftText(A, id)).toEqual({ subject: "Assunto final", body: "Corpo final 3." });
    expect(await rebuildAgentDraftText(B, id)).toBeNull(); // outra empresa
  });

  it("rejeitado nunca sai; não dá para aprovar depois; um novo pedido da mesma semana gera outro rascunho", async () => {
    const id = await ready();
    await agent().reject(ctx(A, "admin"), id);
    await expect(agent().approve(ctx(A), id)).rejects.toBeInstanceOf(AgentStateError);
    await expect(agent().reject(ctx(A), id)).rejects.toBeInstanceOf(AgentStateError);
    expect(await deliveries(A)).toHaveLength(0);
    const again = await agent().requestDraft(ctx(A));
    expect(again).toMatchObject({ created: true });
    expect(again.draft.id).not.toBe(id);
  });

  it("não aprova rascunho que ainda está sendo gerado", async () => {
    await budget(A);
    const { draft } = await agent().requestDraft(ctx(A));
    await expect(agent().approve(ctx(A), draft.id)).rejects.toBeInstanceOf(AgentStateError);
    expect(await deliveries(A)).toHaveLength(0);
  });

  it("aprovações simultâneas do mesmo rascunho enviam uma vez só", async () => {
    const id = await ready();
    await Promise.allSettled([1, 2, 3, 4].map(() => agent().approve(ctx(A), id)));
    expect(await deliveries(A)).toHaveLength(1);
    expect(sharedChannels.provider.accepted).toHaveLength(1);
  });

  it("repetir o pedido da mesma semana devolve o mesmo rascunho, sem nova chamada nem gasto", async () => {
    await budget(A);
    const first = await agent().requestDraft(ctx(A));
    const second = await agent().requestDraft(ctx(A));
    expect(second).toMatchObject({ created: false });
    expect(second.draft.id).toBe(first.draft.id);
    await runWorker();
    expect(providerHits).toBe(1);
    expect(await workItems(A)).toBe(1);
  });

  it("número que o texto citou e não estava nos dados vem marcado para a pessoa ver", async () => {
    providerReply = "A receita foi de R$ 9.999,00 e há 3 entregas atrasadas.";
    const id = await ready();
    await agent().overview(ctx(A)); // recolhe o resultado da fila
    const [row] = await db.select().from(agentDrafts).where(eq(agentDrafts.id, id));
    expect(row!.status).toBe("ready");
    expect(row!.unverifiedNumbers).toEqual(["9.999,00"]);
  });

  it("falha do provedor: rascunho falha com código público, sem texto e sem envio; dá para pedir de novo", async () => {
    await budget(A);
    providerStatus = 500;
    const { draft } = await agent().requestDraft(ctx(A));
    await runWorker();
    const o = await agent().overview(ctx(A));
    expect(o.drafts[0]).toMatchObject({ id: draft.id, status: "failed", draftBody: null });
    expect(["agent.generation_failed", "agent.timeout", "agent.no_provider"]).toContain(o.drafts[0]!.errorCode);
    await expect(agent().approve(ctx(A), draft.id)).rejects.toBeInstanceOf(AgentStateError);
    expect(await deliveries(A)).toHaveLength(0);
    providerStatus = 200;
    expect(await agent().requestDraft(ctx(A))).toMatchObject({ created: true });
  });

  it("sem métricas para resumir, recusa sem gastar", async () => {
    await budget(A);
    await expect(agent(() => clock, async () => []).requestDraft(ctx(A))).rejects.toMatchObject({ reason: "agent.no_numbers" });
    expect(await workItems(A)).toBe(0);
  });
});

describe("agente piloto: isolamento entre empresas", () => {
  it("outra empresa não vê, não aprova, não rejeita e não gasta o orçamento da primeira", async () => {
    await budget(A);
    const { draft } = await agent().requestDraft(ctx(A));
    await runWorker();
    await expect(agent().approve(ctx(B), draft.id)).rejects.toBeInstanceOf(AgentNotFoundError);
    await expect(agent().reject(ctx(B), draft.id)).rejects.toBeInstanceOf(AgentNotFoundError);
    expect((await agent().overview(ctx(B))).drafts).toHaveLength(0);
    await expect(agent().requestDraft(ctx(B))).rejects.toMatchObject({ reason: "agent.disabled" }); // B não tem orçamento
    expect(await deliveries(B)).toHaveLength(0);
    expect(await workItems(B)).toBe(0);
  });
});
