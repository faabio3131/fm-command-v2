import { AlertService } from "@/application/alerts/alert-service";
import { MetricService } from "@/application/metrics/metric-service";
import { PostgresAlertRepository } from "@/infrastructure/alerts/postgres-alert-repository";
import { PostgresMetricStore } from "@/infrastructure/metrics/postgres-metric-store";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export function buildAlertService(): AlertService {
  return new AlertService(
    new PostgresAlertRepository(),
    new MetricService(new PostgresMetricStore()),
    new PostgresProductRepository(),
  );
}
