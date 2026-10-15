import { and, desc, eq, sql } from "drizzle-orm";
import type {
  CanonicalFactRepository,
  NewSourceDefinition,
  SourceDefinition,
  SourceRepository,
  SourceStatus,
  SourceStatusWriter,
  SyncOperationalReader,
  SyncOperationalState,
  SyncRepository,
} from "@/domain/integration/contracts";
import { db } from "@/infrastructure/db/client";
import {
  canonicalFacts,
  sourceDefinitions,
  syncExecutions,
} from "@/infrastructure/db/platform-schema";

function scopedSyncIdempotencyKey(
  sourceId: string,
  idempotencyKey: string,
): string {
  return `${sourceId}:${idempotencyKey}`;
}

function mapSource(
  row: typeof sourceDefinitions.$inferSelect,
): SourceDefinition {
  return {
    id: row.id,
    tenantId: row.tenantId,
    productId: row.productId ?? undefined,
    name: row.name,
    sourceType: row.sourceType,
    authoritativeDomain: row.authoritativeDomain,
    status: row.status as SourceDefinition["status"],
    syncMode: row.syncMode as SourceDefinition["syncMode"],
    secretRef: row.secretRef ?? undefined,
    config: row.config,
    freshnessSeconds: row.freshnessSeconds ?? undefined,
    mappingVersion: row.mappingVersion,
  };
}

export class PostgresSourceRepository
  implements SourceRepository, SourceStatusWriter
{
  async findById(
    tenantId: string,
    sourceId: string,
  ): Promise<SourceDefinition | null> {
    const rows = await db
      .select()
      .from(sourceDefinitions)
      .where(
        and(
          eq(sourceDefinitions.tenantId, tenantId),
          eq(sourceDefinitions.id, sourceId),
        ),
      )
      .limit(1);
    return rows[0] ? mapSource(rows[0]) : null;
  }

  async list(
    tenantId: string,
  ): Promise<readonly SourceDefinition[]> {
    const rows = await db
      .select()
      .from(sourceDefinitions)
      .where(eq(sourceDefinitions.tenantId, tenantId));
    return rows.map(mapSource);
  }

  async create(
    tenantId: string,
    input: NewSourceDefinition,
  ): Promise<SourceDefinition> {
    const rows = await db
      .insert(sourceDefinitions)
      .values({
        tenantId,
        productId: input.productId,
        name: input.name,
        sourceType: input.sourceType,
        authoritativeDomain: input.authoritativeDomain,
        syncMode: input.syncMode,
        secretRef: input.secretRef,
        mappingVersion: input.mappingVersion ?? "v1",
        freshnessSeconds: input.freshnessSeconds,
        config: input.config ?? {},
      })
      .returning();
    return mapSource(rows[0]);
  }

  async updateStatus(
    tenantId: string,
    sourceId: string,
    status: SourceStatus,
  ): Promise<void> {
    await db
      .update(sourceDefinitions)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sourceDefinitions.tenantId, tenantId),
          eq(sourceDefinitions.id, sourceId),
        ),
      );
  }
}

export class PostgresSyncRepository
  implements SyncRepository, SyncOperationalReader
{
  async begin(input: {
    tenantId: string;
    sourceId: string;
    idempotencyKey: string;
    correlationId: string;
    cursorBefore?: string;
  }) {
    const persistedKey = scopedSyncIdempotencyKey(
      input.sourceId,
      input.idempotencyKey,
    );
    const inserted = await db
      .insert(syncExecutions)
      .values({
        tenantId: input.tenantId,
        sourceId: input.sourceId,
        idempotencyKey: persistedKey,
        correlationId: input.correlationId,
        cursorBefore: input.cursorBefore,
        status: "running",
      })
      .onConflictDoNothing({
        target: [
          syncExecutions.tenantId,
          syncExecutions.idempotencyKey,
        ],
      })
      .returning({ id: syncExecutions.id });

    if (inserted[0]) {
      return {
        id: inserted[0].id,
        state: "started" as const,
      };
    }

    const existingRows = await db
      .select({
        id: syncExecutions.id,
        status: syncExecutions.status,
      })
      .from(syncExecutions)
      .where(
        and(
          eq(syncExecutions.tenantId, input.tenantId),
          eq(syncExecutions.sourceId, input.sourceId),
          eq(
            syncExecutions.idempotencyKey,
            persistedKey,
          ),
        ),
      )
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      throw new Error("integration.idempotency_state_missing");
    }
    if (existing.status === "completed") {
      return {
        id: existing.id,
        state: "completed" as const,
      };
    }
    if (existing.status === "running") {
      return {
        id: existing.id,
        state: "running" as const,
      };
    }

    if (existing.status === "failed") {
      const restarted = await db
        .update(syncExecutions)
        .set({
          status: "running",
          cursorBefore: input.cursorBefore,
          cursorAfter: null,
          correlationId: input.correlationId,
          errorCode: null,
          errorMessage: null,
          completedAt: null,
          attempt: sql`${syncExecutions.attempt} + 1`,
        })
        .where(
          and(
            eq(syncExecutions.id, existing.id),
            eq(syncExecutions.tenantId, input.tenantId),
            eq(syncExecutions.status, "failed"),
          ),
        )
        .returning({ id: syncExecutions.id });

      if (restarted[0]) {
        return {
          id: restarted[0].id,
          state: "restarted" as const,
        };
      }

      const racedRows = await db
        .select({
          id: syncExecutions.id,
          status: syncExecutions.status,
        })
        .from(syncExecutions)
        .where(
          and(
            eq(syncExecutions.tenantId, input.tenantId),
            eq(syncExecutions.sourceId, input.sourceId),
            eq(
              syncExecutions.idempotencyKey,
              persistedKey,
            ),
          ),
        )
        .limit(1);

      const raced = racedRows[0];
      if (raced?.status === "completed") {
        return {
          id: raced.id,
          state: "completed" as const,
        };
      }
      if (raced?.status === "running") {
        return {
          id: raced.id,
          state: "running" as const,
        };
      }
    }

    throw new Error("integration.idempotency_state_invalid");
  }

  async complete(input: {
    id: string;
    tenantId: string;
    cursorAfter?: string;
  }) {
    await db
      .update(syncExecutions)
      .set({
        status: "completed",
        cursorAfter: input.cursorAfter,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(syncExecutions.id, input.id),
          eq(syncExecutions.tenantId, input.tenantId),
        ),
      );
  }

  async fail(input: {
    id: string;
    tenantId: string;
    errorCode: string;
    errorMessage: string;
  }) {
    await db
      .update(syncExecutions)
      .set({
        status: "failed",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage.slice(0, 500),
        completedAt: new Date(),
      })
      .where(
        and(
          eq(syncExecutions.id, input.id),
          eq(syncExecutions.tenantId, input.tenantId),
        ),
      );
  }

  async operationalState(
    tenantId: string,
    sourceId: string,
  ): Promise<SyncOperationalState> {
    const [latestAttempt] = await db
      .select({
        status: syncExecutions.status,
        startedAt: syncExecutions.startedAt,
      })
      .from(syncExecutions)
      .where(
        and(
          eq(syncExecutions.tenantId, tenantId),
          eq(syncExecutions.sourceId, sourceId),
        ),
      )
      .orderBy(desc(syncExecutions.startedAt))
      .limit(1);

    const [latestSuccessful] = await db
      .select({
        completedAt: syncExecutions.completedAt,
        cursorAfter: syncExecutions.cursorAfter,
      })
      .from(syncExecutions)
      .where(
        and(
          eq(syncExecutions.tenantId, tenantId),
          eq(syncExecutions.sourceId, sourceId),
          eq(syncExecutions.status, "completed"),
        ),
      )
      .orderBy(desc(syncExecutions.completedAt))
      .limit(1);

    return {
      lastAttemptAt: latestAttempt?.startedAt,
      lastAttemptStatus:
        latestAttempt?.status === "running" ||
        latestAttempt?.status === "completed" ||
        latestAttempt?.status === "failed"
          ? latestAttempt.status
          : undefined,
      lastSuccessfulAt: latestSuccessful?.completedAt ?? undefined,
      lastSuccessfulCursor:
        latestSuccessful?.cursorAfter ?? undefined,
    };
  }
}

export class PostgresCanonicalFactRepository
  implements CanonicalFactRepository
{
  async ingest(input: {
    tenantId: string;
    productId?: string;
    sourceId: string;
    mappingVersion: string;
    fact: {
      externalId: string;
      factType: string;
      payload: Record<string, unknown>;
      sourceTimestamp: Date;
    };
    correlationId: string;
  }) {
    await db
      .insert(canonicalFacts)
      .values({
        tenantId: input.tenantId,
        productId: input.productId,
        sourceId: input.sourceId,
        externalId: input.fact.externalId,
        factType: input.fact.factType,
        payload: input.fact.payload,
        mappingVersion: input.mappingVersion,
        sourceTimestamp: input.fact.sourceTimestamp,
        provenance: {
          correlationId: input.correlationId,
        },
      })
      .onConflictDoNothing();
  }
}
