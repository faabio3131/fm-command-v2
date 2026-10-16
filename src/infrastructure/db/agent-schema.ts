import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Orçamento mensal de um agente por empresa (etapa 11). Sem linha, ou desligado, o agente não roda. Valores em milionésimos da unidade menor, como o uso de IA. */
export const agentBudgets = pgTable("fmcc_agent_budget", {
  tenantId: text("tenant_id").notNull(),
  agentId: text("agent_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  monthlyCapMicroMinor: bigint("monthly_cap_micro_minor", { mode: "number" }).notNull(),
  /** Quanto cada rascunho em andamento reserva do teto até o custo real ser conhecido. */
  reservePerCallMicroMinor: bigint("reserve_per_call_micro_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.agentId] }),
  check("fmcc_agent_budget_ck", sql`${t.monthlyCapMicroMinor} >= 0 and ${t.reservePerCallMicroMinor} >= 0 and ${t.currency} ~ '^[A-Z]{3}$'`),
]);

/** Rascunho de um agente: nada sai sem passar por 'approved'; o texto enviado é sempre o final, aprovado por uma pessoa. */
export const agentDrafts = pgTable("fmcc_agent_draft", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: text("tenant_id").notNull(),
  agentId: text("agent_id").notNull(),
  /** Período que o rascunho cobre (ex.: semana 2026-W42); um rascunho vivo por período. */
  periodKey: text("period_key").notNull(),
  status: text("status").notNull().default("generating"),
  workItemId: uuid("work_item_id"),
  /** Números que o agente recebeu (texto já formatado; indisponível fica indisponível). */
  inputLines: jsonb("input_lines").$type<string[]>().notNull(),
  draftSubject: text("draft_subject"),
  draftBody: text("draft_body"),
  finalSubject: text("final_subject"),
  finalBody: text("final_body"),
  /** Números do texto que não estavam nos dados entregues (a pessoa vê o aviso antes de aprovar). */
  unverifiedNumbers: text("unverified_numbers").array().notNull().default(sql`'{}'::text[]`),
  costMicroMinor: bigint("cost_micro_minor", { mode: "number" }),
  currency: text("currency"),
  errorCode: text("error_code"),
  requestedBy: text("requested_by").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  sentQueued: integer("sent_queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("fmcc_agent_draft_status_ck", sql`${t.status} in ('generating','ready','failed','approved','rejected','sent')`),
  // Um rascunho vivo por (empresa, agente, período): pedir de novo só depois de rejeitar ou falhar.
  uniqueIndex("fmcc_agent_draft_live_uq").on(t.tenantId, t.agentId, t.periodKey).where(sql`${t.status} not in ('rejected','failed')`),
  index("fmcc_agent_draft_tenant_idx").on(t.tenantId, t.createdAt),
]);
