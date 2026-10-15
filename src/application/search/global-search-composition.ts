import { loadTenantIntegrationFeatures } from "@/application/integration/tenant-integration-features";
import { GlobalSearchService } from "@/application/search/global-search-service";
import { PostgresActivityRepository } from "@/infrastructure/activity/postgres-activity-repository";
import { PostgresAlertRepository } from "@/infrastructure/alerts/postgres-alert-repository";
import { PostgresSourceRepository } from "@/infrastructure/integration/postgres-repositories";
import { PostgresProductRepository } from "@/infrastructure/products/postgres-product-repository";
import { PostgresSearchRateLimiter } from "@/infrastructure/search/postgres-search-rate-limiter";

export function buildGlobalSearchService(): GlobalSearchService {
  const sources = new PostgresSourceRepository();
  return new GlobalSearchService(
    new PostgresProductRepository(),
    sources,
    new PostgresAlertRepository(),
    new PostgresActivityRepository(),
    new PostgresSearchRateLimiter(),
    (context) => loadTenantIntegrationFeatures(context, sources),
  );
}
