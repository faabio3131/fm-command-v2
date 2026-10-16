import { buildAlertService } from "@/application/alerts/alert-composition";
import { CustomerIntelligenceService } from "@/application/customer/customer-intelligence-service";
import { FinancialIntelligenceService } from "@/application/finance/financial-intelligence-service";
import { GrowthIntelligenceService } from "@/application/growth/growth-intelligence-service";
import { createMetricService } from "@/application/metrics/metric-composition";
import { OperationalHealthService } from "@/application/operations/operational-health-service";
import { OperationsIntelligenceService } from "@/application/operations/operations-intelligence-service";
import { ProductCockpitService } from "@/application/products/product-cockpit-service";
import { ProductIntelligenceService } from "@/application/products/product-intelligence-service";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresOperationalHealthRepository } from "@/infrastructure/operations/postgres-health-repository";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";

export function buildProductCockpitService(): ProductCockpitService {
  const products = new PostgresProductRepository();
  const metrics = createMetricService();

  return new ProductCockpitService(
    new ProductIntelligenceService(products, metrics),
    new GrowthIntelligenceService(metrics, products),
    new FinancialIntelligenceService(metrics, products),
    new CustomerIntelligenceService(metrics, products),
    new OperationsIntelligenceService(metrics, products),
    new OperationalHealthService(new PostgresOperationalHealthRepository(), products),
    buildAlertService(),
    new PostgresSourceRepository(),
  );
}
