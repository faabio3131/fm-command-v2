import { ActivityFeedService } from "@/application/activity/activity-feed-service";
import { PostgresActivityRepository } from "@/infrastructure/activity/postgres-activity-repository";

export function buildActivityFeedService(): ActivityFeedService {
  return new ActivityFeedService(new PostgresActivityRepository());
}
