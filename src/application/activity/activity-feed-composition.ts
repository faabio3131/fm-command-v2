import { ActivityFeedService } from "@/application/activity/activity-feed-service";
import { createUnitScopeResolver } from "@/application/organization/unit-scope";
import { PostgresActivityRepository } from "@/infrastructure/activity/postgres-activity-repository";

export function buildActivityFeedService(): ActivityFeedService {
  return new ActivityFeedService(new PostgresActivityRepository(), createUnitScopeResolver());
}
