import { and, count, eq, gte, sql } from "drizzle-orm";
import {
  GlobalSearchRateLimitError,
  type SearchRateLimiter,
} from "@/domain/search/contracts";
import { db } from "@/infrastructure/db/client";
import { auditEvents } from "@/infrastructure/db/foundation-schema";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

export class PostgresSearchRateLimiter implements SearchRateLimiter {
  async consume(input: {
    tenantId: string;
    userId: string;
    correlationId: string;
  }): Promise<void> {
    const allowed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`search-rate:${input.tenantId}:${input.userId}`}))`,
      );

      const windowStart = new Date(Date.now() - WINDOW_MS);
      const [row] = await tx
        .select({ total: count() })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.tenantId, input.tenantId),
            eq(auditEvents.actorId, input.userId),
            eq(auditEvents.action, "search.request.allowed"),
            gte(auditEvents.occurredAt, windowStart),
          ),
        );

      if (Number(row?.total ?? 0) >= MAX_REQUESTS_PER_WINDOW) {
        return false;
      }

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorId: input.userId,
        actorType: "user",
        action: "search.request.allowed",
        resourceType: "search",
        result: "allowed",
        correlationId: input.correlationId,
        metadata: {},
      });
      return true;
    });

    if (!allowed) {
      await db.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorId: input.userId,
        actorType: "user",
        action: "search.rate_limit.denied",
        resourceType: "search",
        result: "denied",
        correlationId: input.correlationId,
        metadata: {},
      });
      throw new GlobalSearchRateLimitError(WINDOW_MS / 1000);
    }
  }
}
