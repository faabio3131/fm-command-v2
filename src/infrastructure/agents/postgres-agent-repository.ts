import { and, desc, eq, sql } from "drizzle-orm";
import { budgetDecision, type BudgetDecision } from "@/domain/agents/weekly-summary";
import { db } from "@/infrastructure/db/client";
import { agentBudgets, agentDrafts } from "@/infrastructure/db/agent-schema";

export type DraftStatus = "generating" | "ready" | "failed" | "approved" | "rejected" | "sent";
export interface AgentBudget { enabled: boolean; capMicroMinor: number; reserveMicroMinor: number; currency: string }
export interface AgentDraft {
  id: string; tenantId: string; agentId: string; periodKey: string; status: DraftStatus; workItemId: string | null; inputLines: string[];
  draftSubject: string | null; draftBody: string | null; finalSubject: string | null; finalBody: string | null; unverifiedNumbers: string[];
  costMicroMinor: number | null; currency: string | null; errorCode: string | null; requestedBy: string; decidedBy: string | null; decidedAt: Date | null;
  sentQueued: number | null; createdAt: Date; updatedAt: Date;
}
const toDraft = (r: typeof agentDrafts.$inferSelect): AgentDraft => ({ ...r, status: r.status as DraftStatus, unverifiedNumbers: r.unverifiedNumbers ?? [] });

/** Toda leitura e escrita filtra pela empresa; a reserva de orçamento e a criação do rascunho acontecem juntas, sob trava. */
export class PostgresAgentRepository {
  async getBudget(tenantId: string, agentId: string): Promise<AgentBudget | null> {
    const [r] = await db.select().from(agentBudgets).where(and(eq(agentBudgets.tenantId, tenantId), eq(agentBudgets.agentId, agentId)));
    return r ? { enabled: r.enabled, capMicroMinor: r.monthlyCapMicroMinor, reserveMicroMinor: r.reservePerCallMicroMinor, currency: r.currency } : null;
  }

  async saveBudget(tenantId: string, agentId: string, b: AgentBudget, by: string): Promise<void> {
    const values = { enabled: b.enabled, monthlyCapMicroMinor: b.capMicroMinor, reservePerCallMicroMinor: b.reserveMicroMinor, currency: b.currency, updatedBy: by, updatedAt: new Date() };
    await db.insert(agentBudgets).values({ tenantId, agentId, ...values }).onConflictDoUpdate({ target: [agentBudgets.tenantId, agentBudgets.agentId], set: values });
  }

  /** Gasto do mês (custo real gravado nos rascunhos), reservas em andamento e se algum custo veio em outra moeda. */
  async budgetUsage(tenantId: string, agentId: string, monthStart: Date, monthEnd: Date, currency: string, tx: Pick<typeof db, "execute"> = db) {
    const res = await tx.execute(sql`
      select coalesce(sum(cost_micro_minor) filter (where currency = ${currency}), 0)::bigint as spent,
             count(*) filter (where status = 'generating')::int as in_flight,
             coalesce(bool_or(currency is not null and currency <> ${currency}), false) as mismatch
      from fmcc_agent_draft
      where tenant_id = ${tenantId} and agent_id = ${agentId} and created_at >= ${monthStart} and created_at < ${monthEnd}`);
    const row = (Array.isArray(res) ? res[0] : (res as unknown as { rows: unknown[] }).rows[0]) as { spent: string | number; in_flight: number; mismatch: boolean };
    return { spentMicroMinor: Number(row.spent), inFlight: Number(row.in_flight), currencyMismatch: Boolean(row.mismatch) };
  }

  /**
   * Cria o rascunho só se o orçamento permitir. Sob trava por (empresa, agente) para que dois pedidos ao mesmo tempo não passem juntos do teto.
   * Já existe rascunho vivo do período: devolve o existente, sem nova reserva.
   */
  async reserveDraft(input: { tenantId: string; agentId: string; periodKey: string; inputLines: string[]; requestedBy: string; monthStart: Date; monthEnd: Date }):
    Promise<{ ok: true; draft: AgentDraft; created: boolean } | { ok: false; reason: Exclude<BudgetDecision, { allowed: true }>["reason"] }> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fmcc.agent.${input.tenantId}:${input.agentId}`}, 0))`);
      const [live] = await tx.select().from(agentDrafts).where(and(eq(agentDrafts.tenantId, input.tenantId), eq(agentDrafts.agentId, input.agentId), eq(agentDrafts.periodKey, input.periodKey), sql`${agentDrafts.status} not in ('rejected','failed')`));
      if (live) return { ok: true as const, draft: toDraft(live), created: false };
      const [b] = await tx.select().from(agentBudgets).where(and(eq(agentBudgets.tenantId, input.tenantId), eq(agentBudgets.agentId, input.agentId)));
      const usage = b ? await this.budgetUsage(input.tenantId, input.agentId, input.monthStart, input.monthEnd, b.currency, tx) : null;
      const decision = budgetDecision(b && usage ? { enabled: b.enabled, capMicroMinor: b.monthlyCapMicroMinor, reserveMicroMinor: b.reservePerCallMicroMinor, currency: b.currency, ...usage } : null);
      if (!decision.allowed) return { ok: false as const, reason: decision.reason };
      const [row] = await tx.insert(agentDrafts).values({ tenantId: input.tenantId, agentId: input.agentId, periodKey: input.periodKey, inputLines: input.inputLines, requestedBy: input.requestedBy }).returning();
      return { ok: true as const, draft: toDraft(row!), created: true };
    });
  }

  async attachWorkItem(tenantId: string, id: string, workItemId: string): Promise<void> {
    await db.update(agentDrafts).set({ workItemId, updatedAt: new Date() }).where(and(eq(agentDrafts.tenantId, tenantId), eq(agentDrafts.id, id), eq(agentDrafts.status, "generating")));
  }

  async get(tenantId: string, id: string): Promise<AgentDraft | null> {
    const [r] = await db.select().from(agentDrafts).where(and(eq(agentDrafts.tenantId, tenantId), eq(agentDrafts.id, id)));
    return r ? toDraft(r) : null;
  }

  async list(tenantId: string, agentId: string, limit = 20): Promise<AgentDraft[]> {
    return (await db.select().from(agentDrafts).where(and(eq(agentDrafts.tenantId, tenantId), eq(agentDrafts.agentId, agentId))).orderBy(desc(agentDrafts.createdAt)).limit(limit)).map(toDraft);
  }

  async generating(tenantId: string): Promise<AgentDraft[]> {
    return (await db.select().from(agentDrafts).where(and(eq(agentDrafts.tenantId, tenantId), eq(agentDrafts.status, "generating")))).map(toDraft);
  }

  /** Só passa de 'generating'; repetir não muda nada. */
  async finishGeneration(tenantId: string, id: string, r: { status: "ready" | "failed"; subject?: string; body?: string; unverified?: string[]; costMicroMinor: number | null; currency: string | null; errorCode?: string }): Promise<boolean> {
    const rows = await db.update(agentDrafts).set({
      status: r.status, draftSubject: r.subject ?? null, draftBody: r.body ?? null, unverifiedNumbers: r.unverified ?? [],
      costMicroMinor: r.costMicroMinor, currency: r.currency, errorCode: r.errorCode ?? null, updatedAt: new Date(),
    }).where(and(eq(agentDrafts.tenantId, tenantId), eq(agentDrafts.id, id), eq(agentDrafts.status, "generating"))).returning({ id: agentDrafts.id });
    return rows.length > 0;
  }

  /** A aprovação: só 'ready' vira 'approved', uma vez, com o texto que a pessoa viu e aprovou. */
  async approve(tenantId: string, id: string, by: string, subject: string, body: string, unverified: string[]): Promise<AgentDraft | null> {
    const rows = await db.update(agentDrafts).set({ status: "approved", finalSubject: subject, finalBody: body, unverifiedNumbers: unverified, decidedBy: by, decidedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentDrafts.tenantId, tenantId), eq(agentDrafts.id, id), eq(agentDrafts.status, "ready"))).returning();
    return rows[0] ? toDraft(rows[0]) : null;
  }

  async reject(tenantId: string, id: string, by: string): Promise<boolean> {
    const rows = await db.update(agentDrafts).set({ status: "rejected", decidedBy: by, decidedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentDrafts.tenantId, tenantId), eq(agentDrafts.id, id), eq(agentDrafts.status, "ready"))).returning({ id: agentDrafts.id });
    return rows.length > 0;
  }

  async markSent(tenantId: string, id: string, queued: number): Promise<boolean> {
    const rows = await db.update(agentDrafts).set({ status: "sent", sentQueued: queued, updatedAt: new Date() })
      .where(and(eq(agentDrafts.tenantId, tenantId), eq(agentDrafts.id, id), eq(agentDrafts.status, "approved"))).returning({ id: agentDrafts.id });
    return rows.length > 0;
  }
}
