import { NotificationService } from "@/application/notifications/notification-service";
import { PostgresActivityRepository } from "@/infrastructure/activity/postgres-activity-repository";
import { PostgresAlertRepository } from "@/infrastructure/alerts/postgres-alert-repository";
import { PostgresNotificationStateRepository } from "@/infrastructure/notifications/postgres-notification-state-repository";

export function buildNotificationService(): NotificationService {
  return new NotificationService(
    new PostgresActivityRepository(),
    new PostgresAlertRepository(),
    new PostgresNotificationStateRepository(),
  );
}
