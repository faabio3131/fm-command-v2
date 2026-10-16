import type { ChannelService } from "@/application/channels/channel-service";
import { buildPrompt, unverifiedNumbers, weekKey, WEEKLY_SUMMARY_AGENT, WEEKLY_SUMMARY_MAX_TOKENS, type BudgetDecision } from "@/domain/agents/weekly-summary";
import type { AlertMessageText } from "@/domain/channels/alert-message";
import type { WorkQueue } from "@/domain/core/work-queue";
import { localParts } from "@/domain/reports/schedule";
import { requirePermission, type TenantContext } from "@/domain/security/tenant-context";
import type { Locale } from "@/i18n/locales";
import { createTranslator } from "@/i18n/translate";
import type { AgentDraft, PostgresAgentRepository } from "@/infrastructure/agents/postgres-agent-repository";

export class AgentInputError extends Error { constructor(readonly field: string) { super(`agent.input_invalid:${field}`); this.name = "AgentInputError"; } }
export class AgentNotFoundError extends Error { constructor() { super("agent.draft_not_found"); this.name = "AgentNotFoundError"; } }
export class AgentStateError extends Error { constructor(readonly state: string) { super(`agent.draft_state_${state}`); this.name = "AgentStateError"; } }
export class AgentRefusedError extends Error { constructor(readonly reason: Exclude<BudgetDecision, { allowed: true }>["reason"] | "agent.no_numbers" | "agent.enqueue_failed") { super(reason); this.name = "AgentRefusedError"; } }

export interface WorkResultReader {
  /** Estado e resultado da tarefa na fila, e o custo real gravado no uso de IA (soma de todas as tentativas). */
  read(tenantId: string, workItemId: string): Promise<{ state: string; text: string | null; lastError: string | null; costMicroMinor: number; currency: string | null } | null>;
}
export interface AgentAudit {
  record(input: { tenantId: string; actorId: string; action: string; resourceType: string; resourceId: string | null; result: string; correlationId: string; metadata: Record<string, unknown> }): Promise<void>;
}
export interface AgentServiceDeps {
  readonly repository: Pick<PostgresAgentRepository, "getBudget" | "saveBudget" | "budgetUsage" | "reserveDraft" | "attachWorkItem" | "get" | "list" | "generating" | "finishGeneration" | "approve" | "reject" | "markSent">;
  readonly queue: Pick<WorkQueue, "enqueue">;
  readonly work: WorkResultReader;
  readonly channels: Pick<ChannelService, "notifyAgentDraft">;
  /** Linhas "Métrica: valor" já formatadas, vindas do serviço de métricas (sem valor = indisponível). */
  readonly numberLines: (context: TenantContext, locale: Locale) => Promise<string[]>;
  readonly tenantProfile: (tenantId: string) => Promise<{ timeZone: string; locale: Locale }>;
  readonly audit: AgentAudit;
  readonly now?: () => Date;
}

const MICRO = 1_000_000;
const MAX_SUBJECT = 150;
const MAX_BODY = 6000;

/** Agente piloto (etapa 11): redige o resumo semanal com teto de gasto; só uma pessoa autorizada o libera para envio. */
export class AgentService {
  private readonly now: () => Date;
  constructor(private readonly deps: AgentServiceDeps) { this.now = deps.now ?? (() => new Date()); }

  private monthRange(timeZone: string): { start: Date; end: Date } {
    const p = localParts(this.now(), timeZone);
    // Mês corrente no fuso da empresa; a diferença para UTC (horas) não muda o limite do orçamento de forma relevante, e é a mesma regra das métricas.
    const start = new Date(Date.UTC(p.y, p.m - 1, 1));
    const end = new Date(Date.UTC(p.m === 12 ? p.y + 1 : p.y, p.m === 12 ? 0 : p.m, 1));
    return { start, end };
  }

  async overview(context: TenantContext) {
    requirePermission(context, "agent:read");
    await this.sync(context.tenantId);
    const profile = await this.deps.tenantProfile(context.tenantId);
    const budget = await this.deps.repository.getBudget(context.tenantId, WEEKLY_SUMMARY_AGENT);
    const { start, end } = this.monthRange(profile.timeZone);
    const usage = budget ? await this.deps.repository.budgetUsage(context.tenantId, WEEKLY_SUMMARY_AGENT, start, end, budget.currency) : null;
    return { budget, usage, drafts: await this.deps.repository.list(context.tenantId, WEEKLY_SUMMARY_AGENT) };
  }

  /** Orçamento em unidades menores por mês (ex.: 500 = US$ 5,00). Só o dono altera. */
  async setBudget(context: TenantContext, input: { enabled: unknown; capMinor: unknown; reserveMinor: unknown; currency: unknown }): Promise<void> {
    requirePermission(context, "agent:budget");
    if (typeof input.enabled !== "boolean") throw new AgentInputError("enabled");
    const cap = input.capMinor, reserve = input.reserveMinor;
    if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 0 || cap > 100_000_000) throw new AgentInputError("capMinor");
    if (typeof reserve !== "number" || !Number.isInteger(reserve) || reserve < 0 || reserve > cap) throw new AgentInputError("reserveMinor");
    if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) throw new AgentInputError("currency");
    await this.deps.repository.saveBudget(context.tenantId, WEEKLY_SUMMARY_AGENT, { enabled: input.enabled, capMicroMinor: cap * MICRO, reserveMicroMinor: reserve * MICRO, currency: input.currency }, context.userId);
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "agent.budget_changed", resourceType: "agent_budget", resourceId: WEEKLY_SUMMARY_AGENT, result: "success", correlationId: context.correlationId, metadata: { enabled: input.enabled, capMinor: cap, reserveMinor: reserve, currency: input.currency } });
  }

  /** Pede o rascunho da semana. Idempotente por semana: repetir devolve o mesmo rascunho, sem nova chamada nem novo gasto. */
  async requestDraft(context: TenantContext): Promise<{ draft: AgentDraft; created: boolean }> {
    requirePermission(context, "agent:write");
    await this.sync(context.tenantId);
    const profile = await this.deps.tenantProfile(context.tenantId);
    const lines = await this.deps.numberLines(context, profile.locale);
    if (lines.length === 0) throw new AgentRefusedError("agent.no_numbers");
    const p = localParts(this.now(), profile.timeZone);
    const { start, end } = this.monthRange(profile.timeZone);
    const reserved = await this.deps.repository.reserveDraft({ tenantId: context.tenantId, agentId: WEEKLY_SUMMARY_AGENT, periodKey: weekKey(p.y, p.m, p.d), inputLines: lines, requestedBy: context.userId, monthStart: start, monthEnd: end });
    if (!reserved.ok) {
      await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "agent.draft_refused", resourceType: "agent_draft", resourceId: null, result: "denied", correlationId: context.correlationId, metadata: { reason: reserved.reason } });
      throw new AgentRefusedError(reserved.reason);
    }
    const { draft, created } = reserved;
    if (!created) return { draft, created };
    const tr = createTranslator(profile.locale);
    const prompt = buildPrompt({ locale: profile.locale, dateText: new Intl.DateTimeFormat(profile.locale, { dateStyle: "long", timeZone: profile.timeZone }).format(this.now()), lines, unavailableWord: tr.t("report.unavailable") });
    try {
      const { id } = await this.deps.queue.enqueue({ tenantId: context.tenantId, taskType: "synthesis", locale: profile.locale, payload: { ...prompt, maxTokens: WEEKLY_SUMMARY_MAX_TOKENS }, idempotencyKey: `agent:${WEEKLY_SUMMARY_AGENT}:${draft.id}`, maxAttempts: 2, deadlineInMs: 180_000, priority: 30 });
      await this.deps.repository.attachWorkItem(context.tenantId, draft.id, id);
    } catch {
      await this.deps.repository.finishGeneration(context.tenantId, draft.id, { status: "failed", costMicroMinor: null, currency: null, errorCode: "agent.enqueue_failed" });
      throw new AgentRefusedError("agent.enqueue_failed");
    }
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "agent.draft_requested", resourceType: "agent_draft", resourceId: draft.id, result: "success", correlationId: context.correlationId, metadata: { period: draft.periodKey } });
    return { draft: (await this.deps.repository.get(context.tenantId, draft.id)) ?? draft, created };
  }

  /** Recolhe o resultado das tarefas que terminaram: texto + custo real, ou falha. Idempotente. */
  async sync(tenantId: string): Promise<void> {
    const profile = await this.deps.tenantProfile(tenantId);
    const tr = createTranslator(profile.locale);
    for (const draft of await this.deps.repository.generating(tenantId)) {
      if (!draft.workItemId) {
        if (this.now().getTime() - draft.createdAt.getTime() > 120_000) await this.deps.repository.finishGeneration(tenantId, draft.id, { status: "failed", costMicroMinor: null, currency: null, errorCode: "agent.enqueue_failed" });
        continue;
      }
      const r = await this.deps.work.read(tenantId, draft.workItemId);
      if (!r || r.state === "queued" || r.state === "running") continue;
      const cost = { costMicroMinor: r.costMicroMinor, currency: r.currency };
      if (r.state === "succeeded" && r.text && r.text.trim()) {
        const text = r.text.trim().slice(0, MAX_BODY);
        await this.deps.repository.finishGeneration(tenantId, draft.id, { status: "ready", subject: tr.t("agent.summary.subject"), body: text, unverified: unverifiedNumbers(text, draft.inputLines), ...cost });
      } else {
        const code = (r.lastError ?? "").includes("no_provider") ? "agent.no_provider" : r.state === "expired" ? "agent.timeout" : "agent.generation_failed";
        await this.deps.repository.finishGeneration(tenantId, draft.id, { status: "failed", errorCode: code, ...cost });
      }
    }
  }

  /**
   * Aprovar = autorizar o envio do texto que a pessoa viu (editado ou não). Só 'ready' passa; é o único caminho para o envio.
   * Repetir em rascunho já aprovado apenas tenta de novo o envio (o canal não duplica).
   */
  async approve(context: TenantContext, id: string, edit?: { subject?: unknown; body?: unknown }): Promise<{ queued: number }> {
    requirePermission(context, "agent:approve");
    await this.sync(context.tenantId);
    const draft = await this.deps.repository.get(context.tenantId, id);
    if (!draft) throw new AgentNotFoundError();
    if (draft.status === "sent") return { queued: 0 }; // já enviado: repetir não faz nada
    let current = draft;
    if (draft.status === "ready") {
      const subject = edit?.subject === undefined ? draft.draftSubject : edit.subject;
      const body = edit?.body === undefined ? draft.draftBody : edit.body;
      if (typeof subject !== "string" || !subject.trim() || subject.length > MAX_SUBJECT) throw new AgentInputError("subject");
      if (typeof body !== "string" || !body.trim() || body.length > MAX_BODY) throw new AgentInputError("body");
      const approved = await this.deps.repository.approve(context.tenantId, id, context.userId, subject.trim(), body.trim(), unverifiedNumbers(body, draft.inputLines));
      if (!approved) throw new AgentStateError("changed");
      current = approved;
      await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "agent.draft_approved", resourceType: "agent_draft", resourceId: id, result: "success", correlationId: context.correlationId, metadata: { edited: subject.trim() !== draft.draftSubject || body.trim() !== draft.draftBody, unverified: approved.unverifiedNumbers.length } });
    } else if (draft.status !== "approved") {
      throw new AgentStateError(draft.status);
    }
    const text: AlertMessageText = { subject: current.finalSubject!, body: current.finalBody! };
    const result = await this.deps.channels.notifyAgentDraft({ tenantId: context.tenantId, draftId: id }, text);
    if (await this.deps.repository.markSent(context.tenantId, id, result.queued)) {
      await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "agent.draft_sent", resourceType: "agent_draft", resourceId: id, result: "success", correlationId: context.correlationId, metadata: { queued: result.queued } });
    }
    return { queued: result.queued };
  }

  async reject(context: TenantContext, id: string): Promise<void> {
    requirePermission(context, "agent:approve");
    await this.sync(context.tenantId);
    const draft = await this.deps.repository.get(context.tenantId, id);
    if (!draft) throw new AgentNotFoundError();
    if (!(await this.deps.repository.reject(context.tenantId, id, context.userId))) throw new AgentStateError(draft.status);
    await this.deps.audit.record({ tenantId: context.tenantId, actorId: context.userId, action: "agent.draft_rejected", resourceType: "agent_draft", resourceId: id, result: "success", correlationId: context.correlationId, metadata: {} });
  }
}
