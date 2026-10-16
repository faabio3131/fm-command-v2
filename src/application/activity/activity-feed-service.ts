import type {
  ActivityCategory,
  ActivityFeedOverview,
  ActivityRepository,
} from "@/domain/activity/contracts";
import { ActivityQueryError } from "@/domain/activity/contracts";
import {
  requirePermission,
  type TenantContext,
} from "@/domain/security/tenant-context";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ActivityFeedQuery {
  readonly category?: ActivityCategory;
  readonly productId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export class ActivityFeedService {
  constructor(private readonly activities: ActivityRepository) {}

  async page(
    context: TenantContext,
    input: ActivityFeedQuery = {},
  ): Promise<ActivityFeedOverview> {
    requirePermission(context, "audit:read");

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 25 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new ActivityQueryError();
    }

    if (input.productId && !UUID_PATTERN.test(input.productId)) {
      throw new ActivityQueryError("activity.product_invalid");
    }

    const offset = (page - 1) * pageSize;
    const take = offset + pageSize + 1;
    const rows = await this.activities.project({
      tenantId: context.tenantId,
      category: input.category,
      productId: input.productId,
      take,
    });
    const selected = rows.slice(offset, offset + pageSize);

    return {
      items: selected.map((row) => ({
        ...row,
        occurredAt: row.occurredAt.toISOString(),
      })),
      pagination: {
        page,
        pageSize,
        hasPrevious: page > 1,
        hasNext: rows.length > offset + pageSize,
      },
      filters: {
        category: input.category,
        productId: input.productId,
      },
      windowNote:
        `Página ${page}, até ${pageSize} eventos, em ordem temporal determinística.`,
      dataBoundary:
        "O Activity Feed unifica somente projeções governadas do Audit Ledger e canonical facts existentes. Payload e metadata brutos não são expostos; eventos sem fonte real permanecem ausentes.",
    };
  }

  async recent(
    context: TenantContext,
    limit = 20,
  ): Promise<ActivityFeedOverview> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    return this.page(context, { page: 1, pageSize: safeLimit });
  }
}
