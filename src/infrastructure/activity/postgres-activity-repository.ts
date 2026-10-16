import { and, desc, eq, inArray, not, or, sql } from "drizzle-orm";
import type {
  ActivityCategory,
  ActivityProjectionQuery,
  ActivityProjectionRecord,
  ActivityRecord,
  ActivityRepository,
} from "@/domain/activity/contracts";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";
import {
  canonicalFacts,
  sourceDefinitions,
} from "@/infrastructure/db/platform-schema";

const FINANCE_FACTS = [
  "billing.invoice",
  "payment.settled",
  "receivable.delinquent",
  "cost.infrastructure",
  "cost.operating",
] as const;

const COMMERCIAL_FACTS = [
  "trial.started",
  "subscription.active",
  "subscription.cancelled",
  "lead.created",
] as const;

const OPERATIONS_FACTS = [
  "incident.opened",
  "job.failed",
  "integration.failed",
  "service.error",
  "support.ticket.opened",
  "usage.active_user.day",
  "usage.engagement_event",
] as const;

const KNOWN_FACTS = [
  ...FINANCE_FACTS,
  ...COMMERCIAL_FACTS,
  ...OPERATIONS_FACTS,
] as const;

function auditCategory(action: string): ActivityCategory {
  if (
    action.startsWith("billing.") ||
    action.startsWith("payment.") ||
    action.startsWith("receivable.") ||
    action.startsWith("finance.") ||
    action.startsWith("commercial.billing.")
  ) return "finance";

  if (
    action.startsWith("trial.") ||
    action.startsWith("subscription.") ||
    action.startsWith("lead.") ||
    action.startsWith("commercial.")
  ) return "commercial";

  if (
    action.startsWith("alert.") ||
    action.startsWith("integration.") ||
    action.startsWith("incident.") ||
    action.startsWith("service.") ||
    action.startsWith("job.") ||
    action.startsWith("provider.") ||
    action.startsWith("routing.") ||
    action.startsWith("health.")
  ) return "operations";

  if (
    action.startsWith("auth.") ||
    action.startsWith("security.") ||
    action.startsWith("session.") ||
    action.startsWith("permission.") ||
    action.startsWith("tenant.")
  ) return "security";

  return "system";
}

function factCategory(factType: string): ActivityCategory {
  if ((FINANCE_FACTS as readonly string[]).includes(factType)) return "finance";
  if ((COMMERCIAL_FACTS as readonly string[]).includes(factType)) return "commercial";
  if ((OPERATIONS_FACTS as readonly string[]).includes(factType)) return "operations";
  return "system";
}

function auditCategoryCondition(category?: ActivityCategory) {
  if (!category) return undefined;

  if (category === "finance") {
    return sql<boolean>`(
      ${auditEvents.action} like 'billing.%'
      or ${auditEvents.action} like 'payment.%'
      or ${auditEvents.action} like 'receivable.%'
      or ${auditEvents.action} like 'finance.%'
      or ${auditEvents.action} like 'commercial.billing.%'
    )`;
  }

  if (category === "commercial") {
    return sql<boolean>`(
      ${auditEvents.action} like 'trial.%'
      or ${auditEvents.action} like 'subscription.%'
      or ${auditEvents.action} like 'lead.%'
      or (
        ${auditEvents.action} like 'commercial.%'
        and ${auditEvents.action} not like 'commercial.billing.%'
      )
    )`;
  }

  if (category === "operations") {
    return sql<boolean>`(
      ${auditEvents.action} like 'alert.%'
      or ${auditEvents.action} like 'integration.%'
      or ${auditEvents.action} like 'incident.%'
      or ${auditEvents.action} like 'service.%'
      or ${auditEvents.action} like 'job.%'
      or ${auditEvents.action} like 'provider.%'
      or ${auditEvents.action} like 'routing.%'
      or ${auditEvents.action} like 'health.%'
    )`;
  }

  if (category === "security") {
    return sql<boolean>`(
      ${auditEvents.action} like 'auth.%'
      or ${auditEvents.action} like 'security.%'
      or ${auditEvents.action} like 'session.%'
      or ${auditEvents.action} like 'permission.%'
      or ${auditEvents.action} like 'tenant.%'
    )`;
  }

  return sql<boolean>`not (
    ${auditEvents.action} like 'billing.%'
    or ${auditEvents.action} like 'payment.%'
    or ${auditEvents.action} like 'receivable.%'
    or ${auditEvents.action} like 'finance.%'
    or ${auditEvents.action} like 'commercial.%'
    or ${auditEvents.action} like 'trial.%'
    or ${auditEvents.action} like 'subscription.%'
    or ${auditEvents.action} like 'lead.%'
    or ${auditEvents.action} like 'alert.%'
    or ${auditEvents.action} like 'integration.%'
    or ${auditEvents.action} like 'incident.%'
    or ${auditEvents.action} like 'service.%'
    or ${auditEvents.action} like 'job.%'
    or ${auditEvents.action} like 'provider.%'
    or ${auditEvents.action} like 'routing.%'
    or ${auditEvents.action} like 'health.%'
    or ${auditEvents.action} like 'auth.%'
    or ${auditEvents.action} like 'security.%'
    or ${auditEvents.action} like 'session.%'
    or ${auditEvents.action} like 'permission.%'
    or ${auditEvents.action} like 'tenant.%'
  )`;
}

function factCategoryCondition(category?: ActivityCategory) {
  if (!category) return undefined;
  if (category === "finance") {
    return inArray(canonicalFacts.factType, [...FINANCE_FACTS]);
  }
  if (category === "commercial") {
    return inArray(canonicalFacts.factType, [...COMMERCIAL_FACTS]);
  }
  if (category === "operations") {
    return inArray(canonicalFacts.factType, [...OPERATIONS_FACTS]);
  }
  if (category === "security") {
    return sql<boolean>`false`;
  }
  return not(inArray(canonicalFacts.factType, [...KNOWN_FACTS]));
}

function eventTitle(eventType: string): string {
  const labels: Readonly<Record<string, string>> = {
    "trial.started": "Trial iniciado",
    "subscription.active": "Assinatura ativa observada",
    "subscription.cancelled": "Assinatura cancelada",
    "billing.invoice": "Fatura registrada",
    "payment.settled": "Pagamento liquidado",
    "receivable.delinquent": "Inadimplência registrada",
    "cost.infrastructure": "Custo de infraestrutura registrado",
    "cost.operating": "Custo operacional registrado",
    "lead.created": "Lead criado",
    "incident.opened": "Incidente aberto",
    "job.failed": "Falha de processamento registrada",
    "integration.failed": "Falha de integração registrada",
    "service.error": "Erro de serviço registrado",
    "support.ticket.opened": "Ticket de suporte aberto",
    "usage.active_user.day": "Usuário ativo observado",
    "usage.engagement_event": "Evento de engajamento registrado",
    "alert.raised": "Alerta gerado",
    "alert.acknowledged": "Alerta reconhecido",
    "alert.rule.created": "Regra de alerta criada",
    "alert.rule.disabled": "Regra de alerta desativada",
    "alert.rule.archived": "Regra de alerta arquivada",
    "alert.automation.completed": "Automação de alerta concluída",
    "alert.automation.failed": "Automação de alerta falhou",
    "commercial.billing.command.forwarded": "Comando de billing encaminhado",
    "commercial.command.preview_approved": "Ação comercial aprovada",
    "commercial.command.forwarded": "Comando comercial encaminhado",
    "commercial.command.approval_consumed": "Aprovação comercial consumida",
    "core.query": "Consulta ao Core",
    "executive.analysis": "Análise executiva",
    "product.create": "Produto criado",
    "provider.create": "Provider criado",
    "provider.credential": "Credencial de provider alterada",
    "provider.status": "Status de provider alterado",
    "provider.test": "Teste de provider executado",
    "routing.create": "Roteamento criado",
    "action.intent.prepared": "Ação governada preparada",
    "search.request.allowed": "Busca global executada",
    "search.rate_limit.denied": "Busca global limitada",
  };
  return labels[eventType] ?? `Evento governado · ${eventType}`;
}

function normalizedAmount(value: string | null): string | undefined {
  if (value === null || value.trim() === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? value : undefined;
}

export class PostgresActivityRepository implements ActivityRepository {
  async recent(
    tenantId: string,
    limit: number,
  ): Promise<readonly ActivityRecord[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    return db
      .select({
        id: auditEvents.id,
        actorId: auditEvents.actorId,
        actorType: auditEvents.actorType,
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        result: auditEvents.result,
        correlationId: auditEvents.correlationId,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(safeLimit);
  }

  async project(
    input: ActivityProjectionQuery,
  ): Promise<readonly ActivityProjectionRecord[]> {
    const safeTake = Math.min(Math.max(Math.trunc(input.take), 1), 2501);

    const auditRows = await db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        result: auditEvents.result,
        correlationId: auditEvents.correlationId,
        occurredAt: auditEvents.occurredAt,
        productId: sql<string | null>`coalesce(
          ${auditEvents.metadata}->>'productId',
          case
            when ${auditEvents.resourceType} = 'product'
            then ${auditEvents.resourceId}
          end
        )`,
      })
      .from(auditEvents)
      .where(and(
        eq(auditEvents.tenantId, input.tenantId),
        auditCategoryCondition(input.category),
        input.productId
          ? or(
              and(
                eq(auditEvents.resourceType, "product"),
                eq(auditEvents.resourceId, input.productId),
              ),
              sql<boolean>`${auditEvents.metadata}->>'productId' = ${input.productId}`,
            )
          : undefined,
      ))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(safeTake);

    const factRows = await db
      .select({
        id: canonicalFacts.id,
        productId: canonicalFacts.productId,
        sourceId: canonicalFacts.sourceId,
        factType: canonicalFacts.factType,
        occurredAt: canonicalFacts.sourceTimestamp,
        amount: sql<string | null>`${canonicalFacts.payload}->>'amount'`,
        currency: sql<string | null>`${canonicalFacts.payload}->>'currency'`,
        correlationId: sql<string | null>`${canonicalFacts.provenance}->>'correlationId'`,
        sourceType: sourceDefinitions.sourceType,
        authoritativeDomain: sourceDefinitions.authoritativeDomain,
      })
      .from(canonicalFacts)
      .leftJoin(
        sourceDefinitions,
        and(
          eq(sourceDefinitions.id, canonicalFacts.sourceId),
          eq(sourceDefinitions.tenantId, input.tenantId),
        ),
      )
      .where(and(
        eq(canonicalFacts.tenantId, input.tenantId),
        factCategoryCondition(input.category),
        input.productId
          ? eq(canonicalFacts.productId, input.productId)
          : undefined,
      ))
      .orderBy(desc(canonicalFacts.sourceTimestamp), desc(canonicalFacts.id))
      .limit(safeTake);

    const auditProjection: ActivityProjectionRecord[] = auditRows.map((row) => ({
      id: `audit:${row.id}`,
      productId: row.productId ?? undefined,
      category: auditCategory(row.action),
      eventType: row.action,
      title: eventTitle(row.action),
      occurredAt: row.occurredAt,
      sourceAuthority: "audit_ledger",
      provenanceRefs: [`audit_event:${row.id}`],
      correlationId: row.correlationId,
      result: row.result,
      action: row.action,
    }));

    const factProjection: ActivityProjectionRecord[] = factRows.map((row) => {
      const amount = normalizedAmount(row.amount);
      return {
        id: `fact:${row.id}`,
        productId: row.productId ?? undefined,
        category: factCategory(row.factType),
        eventType: row.factType,
        title: eventTitle(row.factType),
        occurredAt: row.occurredAt,
        amount,
        unit: amount ? "currency" : undefined,
        currency: amount ? row.currency ?? undefined : undefined,
        sourceAuthority:
          row.sourceType ??
          row.authoritativeDomain ??
          "canonical_fact",
        provenanceRefs: [
          `canonical_fact:${row.id}`,
          `source:${row.sourceId}`,
        ],
        correlationId: row.correlationId ?? undefined,
      };
    });

    return [...auditProjection, ...factProjection]
      .sort(
        (left, right) =>
          right.occurredAt.getTime() - left.occurredAt.getTime() ||
          right.id.localeCompare(left.id),
      )
      .slice(0, safeTake);
  }
}
