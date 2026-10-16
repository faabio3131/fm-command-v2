import { AlertService } from "@/application/alerts/alert-service";
import { createMetricService } from "@/application/metrics/metric-composition";
import { PostgresAlertRepository } from "@/infrastructure/alerts/postgres-alert-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export function buildAlertService(): AlertService {
  return new AlertService(
    new PostgresAlertRepository(),
    createMetricService(),
    new PostgresProductRepository(),
  );
}
