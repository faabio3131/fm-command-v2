import type { UnitScope } from "@/domain/organization/unit-hierarchy";

export type ActivityCategory =
  | "finance"
  | "commercial"
  | "operations"
  | "system"
  | "security";

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  "finance",
  "commercial",
  "operations",
  "system",
  "security",
];

export interface ActivityRecord {
  readonly id: string;
  readonly actorId: string;
  readonly actorType: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly result: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
}

export interface ActivityProjectionRecord {
  readonly id: string;
  readonly productId?: string;
  readonly category: ActivityCategory;
  readonly eventType: string;
  readonly title: string;
  readonly occurredAt: Date;
  readonly actorRef?: string;
  readonly amount?: string;
  readonly unit?: string;
  readonly currency?: string;
  readonly severity?: string;
  readonly sourceAuthority: string;
  readonly provenanceRefs: readonly string[];
  readonly correlationId?: string;
  readonly result?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string | null;
}

export interface ActivityProjectionQuery {
  readonly tenantId: string;
  /**
   * Escopo de unidades de quem consulta (ADR-019). Obrigatorio de proposito: sem ele nao ha como compilar uma consulta.
   * Fatos so aparecem se a unidade deles estiver no escopo; eventos de auditoria (nivel da empresa) so para quem enxerga tudo.
   */
  readonly unitScope: UnitScope;
  readonly category?: ActivityCategory;
  readonly productId?: string;
  readonly take: number;
}

export interface ActivityRepository {
  recent(
    tenantId: string,
    limit: number,
    unitScope: UnitScope,
  ): Promise<readonly ActivityRecord[]>;
  project(
    input: ActivityProjectionQuery,
  ): Promise<readonly ActivityProjectionRecord[]>;
}

export interface ActivityFeedItem {
  readonly id: string;
  readonly productId?: string;
  readonly category: ActivityCategory;
  readonly eventType: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly actorRef?: string;
  readonly amount?: string;
  readonly unit?: string;
  readonly currency?: string;
  readonly severity?: string;
  readonly sourceAuthority: string;
  readonly provenanceRefs: readonly string[];
  readonly correlationId?: string;
  readonly result?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string | null;
}

export interface ActivityFeedOverview {
  readonly items: readonly ActivityFeedItem[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly hasPrevious: boolean;
    readonly hasNext: boolean;
  };
  readonly filters: {
    readonly category?: ActivityCategory;
    readonly productId?: string;
  };
  readonly windowNote: string;
  readonly dataBoundary: string;
}

export class ActivityQueryError extends Error {
  constructor(message = "activity.query_invalid") {
    super(message);
    this.name = "ActivityQueryError";
  }
}
